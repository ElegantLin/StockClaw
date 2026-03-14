import { randomUUID } from "node:crypto";

import { archiveSessionToMemory } from "./memory/session-archive.js";
import {
  syncAppSessionSummary,
  writeCompactedSessionSummary,
} from "./memory/session-summary.js";
import { runSessionCompactionSummaryTurn } from "./memory/session-compaction-summary.js";
import { buildPortfolioSummary } from "./memory/summary.js";
import { MemoryService } from "./memory/service.js";
import {
  classifyIntent,
  isSessionResetCommand,
  normalizeResetCommand,
} from "./orchestrator/intents.js";
import { buildSpecialistResponse } from "./orchestrator/responses.js";
import { PortfolioStore } from "./portfolio/store.js";
import { PromptRegistry } from "./prompts/registry.js";
import type { RuntimeEventLogger } from "./runtime-logging/logger.js";
import { ResearchCoordinator } from "./agents/coordinator.js";
import { TradeExecutor } from "./execution/executor.js";
import { SessionService } from "./sessions/service.js";
import type {
  AppSessionRecord,
  ConfigSnapshot,
  IntentType,
  OrchestratorResult,
  PortfolioSnapshot,
  TradeExecutionRequest,
  TradeExecutionResult,
  UserRequest,
  UserResponsePayload,
} from "./types.js";
import { ControlPlaneGateway } from "./control-plane/gateway.js";
import type { RestartRequestResult } from "./restart/types.js";
import type { CronJob, CronJobCreateInput, CronJobPatch, CronInspectionPayload } from "./cron/types.js";
import type { PiRuntime } from "./pi/runtime.js";

export class Orchestrator {
  constructor(
    private readonly prompts: PromptRegistry,
    private readonly memory: MemoryService,
    private readonly portfolio: PortfolioStore,
    private readonly coordinator: ResearchCoordinator,
    private readonly executor: TradeExecutor,
    private readonly sessions: SessionService,
    private readonly controlPlane: ControlPlaneGateway,
    private readonly runtimeLogger: RuntimeEventLogger | null = null,
    private readonly piRuntime: PiRuntime | null = null,
  ) {}

  classifyIntent(message: string): IntentType {
    return classifyIntent(message);
  }

  async createSession(params: { sessionId?: string; userId?: string; channel?: "web" | "telegram" }): Promise<AppSessionRecord> {
    const sessionId = params.sessionId?.trim() || randomUUID();
    return this.sessions.createSession({
      sessionId,
      userId: params.userId?.trim() || "web-user",
      channel: params.channel || "web",
    });
  }

  async getSession(sessionId: string): Promise<AppSessionRecord | null> {
    return this.sessions.getSession(sessionId);
  }

  async getSessionSpawns(sessionId: string, requestId?: string) {
    return this.coordinator.getSpawnHistory(sessionId, requestId);
  }

  async getSessionStatus(sessionId: string, requestId?: string) {
    return this.coordinator.getSessionStatus(sessionId, requestId);
  }

  async getSessionBacktests(sessionId: string, limit?: number) {
    return this.coordinator.getSessionBacktests(sessionId, limit);
  }

  async compactSession(sessionId: string): Promise<{
    ok: boolean;
    message: string;
  }> {
    const session = await this.sessions.getSession(sessionId);
    if (!session || session.transcript.length === 0) {
      return {
        ok: false,
        message: "No active session transcript is available to compact.",
      };
    }
    const result = await this.coordinator.compactSession(sessionId, session.lastIntent ?? "chat");
    if (!result.compacted) {
      return {
        ok: false,
        message: "No persistent root session was found to compact yet.",
      };
    }
    if (result.summaryMarkdown) {
      const timestamp = new Date().toISOString();
      await this.sessions.updateSessionSummary({
        sessionId,
        summary: result.summaryMarkdown,
        timestamp,
      });
    }
    return {
      ok: true,
      message: "The active session context was compacted successfully.",
    };
  }

  async handle(request: UserRequest): Promise<OrchestratorResult> {
    if (isSessionResetCommand(request.message)) {
      const result = await this.handleSessionReset(request);
      await this.sessions.appendAssistantResult({
        sessionId: request.sessionId,
        intent: "chat",
        response: result.response,
        timestamp: request.timestamp,
      });
      return result;
    }

    await this.sessions.ensureRequestSession(request);
    await this.sessions.appendUserMessage(request);

    const intent = this.classifyIntent(request.message);
    await this.runtimeLogger?.info({
      component: "orchestrator",
      type: "request_received",
      sessionId: request.sessionId,
      requestId: request.requestId,
      profileId: "orchestrator",
      data: {
        channel: request.channel,
        intent,
      },
    });
    const specialist = await this.buildResponse(request);
    const response = buildSpecialistResponse(request, specialist);
    const record = await this.sessions.appendAssistantResult({
      sessionId: request.sessionId,
      intent,
      response,
      usage: specialist.usage,
      timestamp: request.timestamp,
    });
    const summary = specialist.compacted
      ? await this.buildCompactedSummary(record)
      : await syncAppSessionSummary({
          memory: this.memory,
          session: record,
        });
    await this.sessions.updateSessionSummary({
      sessionId: record.sessionId,
      summary: summary.markdown,
      timestamp: request.timestamp,
    });
    await this.runtimeLogger?.info({
      component: "orchestrator",
      type: "request_completed",
      sessionId: request.sessionId,
      requestId: request.requestId,
      profileId: "orchestrator",
      data: {
        intent,
        toolCallCount: specialist.toolCalls.length,
      },
    });
    return { intent, response };
  }

  async getPortfolioPayload(): Promise<{ snapshot: PortfolioSnapshot; summary: string }> {
    const snapshot = await this.portfolio.load();
    const summary = buildPortfolioSummary(snapshot);
    await this.memory.writeDocument("portfolio/summary.md", summary);
    return { snapshot, summary };
  }

  async importPortfolio(snapshot: PortfolioSnapshot): Promise<{ snapshot: PortfolioSnapshot; summary: string }> {
    const saved = await this.executor.replacePortfolio(snapshot);
    return {
      snapshot: saved,
      summary: buildPortfolioSummary(saved),
    };
  }

  async executeTrade(execution: TradeExecutionRequest): Promise<TradeExecutionResult> {
    return this.executor.execute({
      symbol: execution.symbol,
      side: execution.action === "paper_buy" ? "buy" : "sell",
      quantity: execution.quantity,
      orderType: execution.orderType,
      limitPrice: execution.limitPrice,
      rationale: execution.rationale,
    }, {
      sessionId: "web:trade-api",
      rootUserMessage: [
        "Direct trade execution request.",
        `Action: ${execution.action}.`,
        `Symbol: ${execution.symbol}.`,
        `Quantity: ${execution.quantity}.`,
        `Order type: ${execution.orderType}.`,
        execution.limitPrice != null ? `Limit price: ${execution.limitPrice}.` : "",
        execution.rationale ? `Rationale: ${execution.rationale}` : "",
      ].filter(Boolean).join(" "),
      purpose: "Resolve a live executable quote for a direct paper-trade API request.",
    });
  }

  async getConfig(target: "llm" | "mcp" | "all" = "all"): Promise<ConfigSnapshot> {
    return this.controlPlane.getConfig(target);
  }

  async patchConfig(target: "llm" | "mcp", patch: string): Promise<ConfigSnapshot> {
    return this.controlPlane.patchConfig(target, patch);
  }

  async installOperation(params:
    | {
        kind: "mcp";
        name: string;
        command: string;
        args: string[];
        cwd?: string;
        env?: Record<string, string>;
      }
    | {
        kind: "skill";
        source: string;
        name?: string;
      }): Promise<unknown> {
    if (params.kind === "mcp") {
      return this.controlPlane.installMcp(params);
    }
    return this.controlPlane.installSkill(params);
  }

  async requestRestart(params: {
    sessionId: string;
    channel: "web" | "telegram";
    note: string;
    reason?: string;
  }): Promise<RestartRequestResult | null> {
    return this.controlPlane.requestRestart(params);
  }

  async inspectCron(): Promise<CronInspectionPayload | null> {
    return this.controlPlane.inspectCron();
  }

  async listCronJobs(): Promise<CronJob[]> {
    return (await this.controlPlane.listCronJobs()) ?? [];
  }

  async addCronJob(job: CronJobCreateInput): Promise<CronJob> {
    const created = await this.controlPlane.addCronJob(job);
    if (!created) {
      throw new Error("Cron service is unavailable.");
    }
    return created;
  }

  async updateCronJob(jobId: string, patch: CronJobPatch): Promise<CronJob> {
    const updated = await this.controlPlane.updateCronJob(jobId, patch);
    if (!updated) {
      throw new Error("Cron service is unavailable.");
    }
    return updated;
  }

  async removeCronJob(jobId: string): Promise<{ ok: true; jobId: string }> {
    const removed = await this.controlPlane.removeCronJob(jobId);
    if (!removed) {
      throw new Error("Cron service is unavailable.");
    }
    return removed;
  }

  async runCronJob(jobId: string) {
    const result = await this.controlPlane.runCronJob(jobId);
    if (!result) {
      throw new Error("Cron service is unavailable.");
    }
    return result;
  }

  private async buildResponse(request: UserRequest) {
    return this.coordinator.runRootTurn(request);
  }

  private async buildCompactedSummary(session: AppSessionRecord) {
    if (!this.piRuntime) {
      return syncAppSessionSummary({
        memory: this.memory,
        session,
      });
    }
    const summaryBody = await runSessionCompactionSummaryTurn({
      piRuntime: this.piRuntime,
      prompts: this.prompts,
      sessionId: session.sessionId,
      transcript: session.transcript,
      intent: session.lastIntent ?? "chat",
    });
    return writeCompactedSessionSummary({
      memory: this.memory,
      sessionId: session.sessionId,
      summaryBody,
      lastIntent: session.lastIntent,
      updatedAt: session.updatedAt,
    });
  }

  private async handleSessionReset(request: UserRequest): Promise<OrchestratorResult> {
    const existing = await this.sessions.ensureRequestSession(request);
    const command = normalizeResetCommand(request.message);
    const archived = await archiveSessionToMemory({
      memory: this.memory,
      session: existing,
      command,
      timestamp: request.timestamp,
    });
    await this.coordinator.resetSession(request.sessionId);
    const resetSession = await this.sessions.resetSession(request.sessionId, request.timestamp);
    if (resetSession) {
      const summary = await syncAppSessionSummary({
        memory: this.memory,
        session: resetSession,
      });
      await this.sessions.updateSessionSummary({
        sessionId: resetSession.sessionId,
        summary: summary.markdown,
        timestamp: request.timestamp,
      });
    }
    const message = archived
      ? `Session context archived to ${archived} and the active session has been reset.`
      : "The active session has been reset. There was no prior transcript to archive.";
    return {
      intent: "chat",
      response: {
        requestId: request.requestId,
        sessionId: request.sessionId,
        message,
        blocks: [],
        actions: [],
      },
    };
  }
}
