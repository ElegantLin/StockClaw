import type { MemoryService } from "../memory/service.js";
import { DURABLE_MEMORY_CATEGORIES } from "../memory/bootstrap-files.js";
import type { PortfolioStore } from "../portfolio/store.js";
import type { PromptRegistry } from "../prompts/registry.js";
import type { PiRuntime } from "../pi/runtime.js";
import type { BacktestService } from "../backtest/service.js";
import type { CronService } from "../cron/service.js";
import { AgentProfileRegistry } from "../control/agent-profiles.js";
import { ToolPolicyService } from "../control/tool-policy.js";
import { buildLiveSessionSummaryPath } from "../memory/session-summary.js";
import type { RuntimeEventLogger } from "../runtime-logging/logger.js";
import type { SessionService } from "../sessions/service.js";
import { SpawnStore, type SpawnedSessionRecord } from "../state/spawn-store.js";
import { resolveSessionContextUsage } from "../status/context.js";
import type { SessionSpawnRequest, SessionStatusPayload, SpecialistResult } from "../types.js";

export class SessionSpawnService {
  constructor(
    private readonly piRuntime: PiRuntime,
    private readonly prompts: PromptRegistry,
    private readonly memory: MemoryService,
    private readonly portfolio: PortfolioStore,
    private readonly profiles: AgentProfileRegistry,
    private readonly policy: ToolPolicyService,
    private readonly sessions: SessionService,
    private readonly store: SpawnStore,
    private readonly backtests: BacktestService,
    private readonly cron: CronService,
    private readonly contextWindow: number,
    private readonly compactionThresholdTokens: number,
    private readonly runtimeLogger: RuntimeEventLogger | null = null,
  ) {}

  async spawn(request: SessionSpawnRequest): Promise<SpecialistResult> {
    const requester = this.profiles.get(request.requesterProfileId);
    if (!requester.spawnCapabilities.includes(request.profileId)) {
      throw new Error(`${request.requesterProfileId} cannot spawn ${request.profileId}.`);
    }

    const profile = this.profiles.get(request.profileId);
    const sequence = (await this.store.listByRequest(request.rootSessionId, request.requestId)).length + 1;
    const sessionKey = `${request.rootSessionId}:${request.requestId}:${request.profileId}:${sequence}`;
    await this.runtimeLogger?.info({
      component: "spawn",
      type: "spawn_started",
      sessionId: request.rootSessionId,
      requestId: request.requestId,
      profileId: request.requesterProfileId,
      data: {
        targetProfileId: request.profileId,
        sequence,
      },
    });
    const run = await this.piRuntime.runEphemeral({
      sessionKey,
      systemPrompt: await this.prompts.composeAgentPrompt(profile.id),
      userPrompt: await this.buildSubagentTask(request.rootUserMessage, request.task),
      customTools: this.policy.createTools(profile.id, {
        scope: "subagent",
        sessionKey,
        profileId: profile.id,
        requestId: request.requestId,
        rootUserMessage: request.rootUserMessage,
      }),
    });

    const record: SpawnedSessionRecord = {
      rootSessionId: request.rootSessionId,
      requestId: request.requestId,
      role: profile.id,
      sessionId: run.sessionId,
      message: run.message,
      toolCalls: run.toolCalls,
      usage: run.usage,
      task: request.task,
      createdAt: new Date().toISOString(),
    };
    await this.store.append(record);
    await this.runtimeLogger?.info({
      component: "spawn",
      type: "spawn_completed",
      sessionId: request.rootSessionId,
      requestId: request.requestId,
      profileId: request.requesterProfileId,
      data: {
        targetProfileId: request.profileId,
        toolCallCount: run.toolCalls.length,
      },
    });
    return record;
  }

  async list(rootSessionId: string): Promise<SpecialistResult[]> {
    return this.store.listByRootSession(rootSessionId);
  }

  async history(rootSessionId: string, requestId?: string): Promise<SpecialistResult[]> {
    if (requestId) {
      return this.store.listByRequest(rootSessionId, requestId);
    }
    return this.store.listByRootSession(rootSessionId);
  }

  async clear(rootSessionId: string): Promise<void> {
    const spawned = await this.store.listByRootSession(rootSessionId);
    await Promise.all(
      spawned.map((record) =>
        this.memory.deleteDocument(buildLiveSessionSummaryPath(record.sessionId)),
      ),
    );
    await this.store.clearRootSession(rootSessionId);
  }

  async status(rootSessionId: string, requestId?: string): Promise<SessionStatusPayload> {
    const session = await this.sessions.getSession(rootSessionId);
    if (!session) {
      throw new Error(`Unknown app session '${rootSessionId}'.`);
    }
    const specialists = requestId
      ? await this.store.listByRequest(rootSessionId, requestId)
      : await this.store.listByRootSession(rootSessionId);
    const backtests = await this.backtests.getSessionJobsSnapshot(rootSessionId, 1);
    const cronInspection = await this.cron.inspect();
    const cronJobs = cronInspection.jobs
      .filter((job) => job.target.sessionId === rootSessionId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    return {
      sessionId: rootSessionId,
      requestId: requestId ?? null,
      lastIntent: session.lastIntent,
      transcriptEntries: session.transcript.length,
      sessionSummary: session.sessionSummary,
      updatedAt: session.updatedAt,
      contextUsage: resolveSessionContextUsage(session, this.contextWindow, this.compactionThresholdTokens),
      lastUsage: session.lastUsage,
      cumulativeUsage: session.cumulativeUsage,
      specialistCount: specialists.length,
      specialists,
      backtests: {
        ...backtests.counts,
        jobs: backtests.jobs.map((job) => ({
          jobId: job.jobId,
          status: job.status,
          kind: job.kind,
          symbols: [...job.symbols],
          dateFrom: job.dateFrom,
          dateTo: job.dateTo,
          runId: job.runId,
          datasetId: job.datasetId,
          submittedAt: job.submittedAt,
          startedAt: job.startedAt,
          completedAt: job.completedAt,
          deliveredAt: job.deliveredAt,
          reportSummary: job.reportSummary,
          error: job.error,
        })),
      },
      crons: {
        total: cronJobs.length,
        active: cronJobs.filter((job) => job.enabled).length,
        running: cronJobs.filter((job) => job.state.lastOutcome === "running").length,
        jobs: cronJobs.slice(0, 1).map((job) => ({
          jobId: job.id,
          name: job.name,
          enabled: job.enabled,
          updatedAt: job.updatedAt,
          nextRunAt: job.state.nextRunAt,
          lastOutcome: job.state.lastOutcome,
        })),
      },
    };
  }

  async getSessionBacktests(rootSessionId: string, limit?: number) {
    return this.backtests.getSessionJobsSnapshot(rootSessionId, limit);
  }

  private async buildSubagentTask(rootUserMessage: string, task: string): Promise<string> {
    const portfolioSnapshot = await this.portfolio.load();
    const memoryContext = await this.loadMemoryContext();
    return [
      `Original user request: ${rootUserMessage}`,
      "",
      `Subagent task: ${task}`,
      "",
      "Portfolio snapshot:",
      JSON.stringify(portfolioSnapshot, null, 2),
      "",
      "Durable memory excerpt:",
      memoryContext || "(none)",
      "",
      "Complete only the requested specialist task. Stay in role and return concise evidence-backed analysis.",
    ].join("\n");
  }

  private async loadMemoryContext(): Promise<string> {
    const sections = await Promise.all(
      DURABLE_MEMORY_CATEGORIES.map((category) => this.memory.readCategory(category)),
    );
    return sections
      .flat()
      .map((document) => `## ${document.path}\n\n${document.content.trim()}`)
      .join("\n\n")
      .trim();
  }
}
