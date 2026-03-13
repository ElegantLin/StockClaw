import { randomUUID } from "node:crypto";

import type { McpRuntime } from "../mcp/runtime.js";
import type { PiRuntime } from "../pi/runtime.js";
import { PortfolioStore } from "../portfolio/store.js";
import type { PromptRegistry } from "../prompts/registry.js";
import type { PortfolioSnapshot } from "../types.js";
import type { SessionService } from "../sessions/service.js";
import type { BacktestJobStore, BacktestStore } from "../state/index.js";
import { BacktestArtifactService, buildBacktestMarkdownReport } from "./artifacts.js";
import type { BacktestTraceSink } from "./artifacts.js";
import { BacktestContextResolverService } from "./context-resolver.js";
import { BacktestDecisionRunner } from "./decision-runner.js";
import { BacktestEngine } from "./engine.js";
import { buildBacktestJobResultMarkdown, buildBacktestJobSubmissionNote } from "./messages.js";
import type { BacktestNotifier } from "./notifier.js";
import { BacktestDatasetPreparer } from "./preparer.js";
import { createInitialBacktestPortfolio, normalizeSymbol } from "./state.js";
import type {
  BacktestAssetInput,
  BacktestCurrentPortfolioJobInput,
  BacktestDataset,
  BacktestEntryKind,
  BacktestExecutionPolicy,
  BacktestHistoricalBar,
  BacktestJob,
  BacktestJobCounts,
  BacktestJobInput,
  BacktestJobSubmissionResult,
  BacktestPortfolioInput,
  BacktestPrepareResult,
  BacktestRun,
  BacktestRunResult,
  BacktestSessionJobsSnapshot,
} from "./types.js";
import { BacktestWorkerLock } from "./worker-lock.js";

export class BacktestService {
  private readonly engine: BacktestEngine;
  private readonly artifacts: BacktestArtifactService;
  private readonly preparer: BacktestDatasetPreparer;
  private readonly processing = new Map<string, Promise<void>>();
  private readonly maxConcurrency: number;
  private readonly deliveryRetryDelayMs: number;
  private readonly workerPollIntervalMs: number;
  private readonly workerOwnerId = randomUUID();
  private closed = false;
  private workerOwned = false;
  private pumpInFlight = false;
  private readonly workerLock: BacktestWorkerLock;
  private pollTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly store: BacktestStore,
    private readonly jobs: BacktestJobStore,
    private readonly notifier: BacktestNotifier,
    private readonly mcpRuntime: McpRuntime,
    private readonly piRuntime: PiRuntime,
    private readonly prompts: PromptRegistry,
    private readonly portfolioStore: PortfolioStore,
    private readonly sessions: SessionService,
    options: {
      workerLock?: BacktestWorkerLock;
      artifacts?: BacktestArtifactService;
      preparer?: BacktestDatasetPreparer;
      contextResolver?: BacktestContextResolverService;
      maxConcurrency?: number;
      deliveryRetryDelayMs?: number;
      workerPollIntervalMs?: number;
    } = {},
  ) {
    const availableMcpTools = () => this.mcpRuntime.listTools();
    const contextResolver =
      options.contextResolver ??
      new BacktestContextResolverService(this.store, this.piRuntime, this.prompts, availableMcpTools);
    this.engine = new BacktestEngine(
      this.store,
      new BacktestDecisionRunner(this.piRuntime, this.prompts, contextResolver),
    );
    this.artifacts = options.artifacts ?? new BacktestArtifactService();
    this.preparer =
      options.preparer ?? new BacktestDatasetPreparer(this.piRuntime, this.prompts, availableMcpTools);
    this.workerLock = options.workerLock ?? new BacktestWorkerLock();
    this.maxConcurrency = Math.max(1, options.maxConcurrency ?? 1);
    this.deliveryRetryDelayMs = Math.max(50, options.deliveryRetryDelayMs ?? 30_000);
    this.workerPollIntervalMs = Math.max(50, options.workerPollIntervalMs ?? 5_000);
  }

  async start(): Promise<void> {
    this.closed = false;
    this.startPoller();
    if (await this.ensureWorkerOwnership()) {
      this.schedulePump();
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    this.stopPoller();
    await Promise.allSettled(this.processing.values());
    this.processing.clear();
    if (this.workerOwned) {
      await this.workerLock.release(this.workerOwnerId);
      this.workerOwned = false;
    }
  }

  async prepareAsset(params: BacktestAssetInput, context: { sessionId: string; rootUserMessage: string }): Promise<BacktestPrepareResult> {
    return this.prepare({
      kind: "asset",
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      executionPolicy: executionPolicyFrom(params),
      initialPortfolio: createInitialBacktestPortfolio({
        accountId: "backtest",
        mode: "backtest",
        cash: params.initialCash,
        equity: params.initialCash,
        buyingPower: params.initialCash,
        positions: [],
        openOrders: [],
        updatedAt: "",
      }),
      symbols: [normalizeSymbol(params.symbol)],
      sessionId: context.sessionId,
      rootUserMessage: context.rootUserMessage,
    });
  }

  async preparePortfolio(params: BacktestPortfolioInput, context: { sessionId: string; rootUserMessage: string }): Promise<BacktestPrepareResult> {
    const positions = params.positions.map((position) => ({
      symbol: normalizeSymbol(position.symbol),
      quantity: position.quantity,
      avgCost: position.avgCost ?? position.marketPrice ?? 0,
      marketPrice: position.marketPrice ?? position.avgCost ?? null,
      marketValue:
        position.marketValue ??
        ((position.marketPrice ?? position.avgCost) != null
          ? position.quantity * (position.marketPrice ?? position.avgCost ?? 0)
          : null),
      currency: position.currency ?? "USD",
    }));
    return this.prepare({
      kind: "portfolio",
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      executionPolicy: executionPolicyFrom(params),
      initialPortfolio: createInitialBacktestPortfolio({
        accountId: "backtest",
        mode: "backtest",
        cash: params.cash,
        equity: params.cash,
        buyingPower: params.cash,
        positions,
        openOrders: [],
        updatedAt: "",
      }),
      symbols: positions.map((position) => position.symbol),
      sessionId: context.sessionId,
      rootUserMessage: context.rootUserMessage,
    });
  }

  async prepareCurrentPortfolio(params: {
    dateFrom: string;
    dateTo: string;
    feesBps?: number;
    slippageBps?: number;
    spawnSpecialists?: boolean;
    initialPortfolioSnapshot?: PortfolioSnapshot;
  }, context: { sessionId: string; rootUserMessage: string }): Promise<BacktestPrepareResult> {
    const current = params.initialPortfolioSnapshot ?? await this.portfolioStore.load();
    return this.prepare({
      kind: "current_portfolio",
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      executionPolicy: executionPolicyFrom(params),
      initialPortfolio: createInitialBacktestPortfolio({
        ...current,
        mode: "backtest",
      }),
      symbols: current.positions.map((position) => normalizeSymbol(position.symbol)),
      sessionId: context.sessionId,
      rootUserMessage: context.rootUserMessage,
    });
  }

  async runDataset(runId: string, options: { trace?: BacktestTraceSink | null } = {}): Promise<BacktestRunResult> {
    const run = await this.store.getRun(runId);
    if (!run) {
      throw new Error(`Unknown backtest run '${runId}'.`);
    }
    if ((run.status === "completed" || run.status === "failed") && run.report) {
      return {
        runId: run.runId,
        datasetId: run.datasetId,
        parentSessionId: run.parentSessionId,
        status: run.status,
        report: run.report,
        error: run.error,
      };
    }
    return this.engine.run(run, options.trace ?? null);
  }

  async submitAssetJob(
    params: BacktestAssetInput,
    context: { sessionId: string; requestId?: string; rootUserMessage: string },
  ): Promise<BacktestJobSubmissionResult> {
    return this.submitJob(
      {
        kind: "asset",
        ...params,
      },
      context,
    );
  }

  async submitPortfolioJob(
    params: BacktestPortfolioInput,
    context: { sessionId: string; requestId?: string; rootUserMessage: string },
  ): Promise<BacktestJobSubmissionResult> {
    return this.submitJob(
      {
        kind: "portfolio",
        ...params,
      },
      context,
    );
  }

  async submitCurrentPortfolioJob(
    params: { dateFrom: string; dateTo: string; feesBps?: number; slippageBps?: number; spawnSpecialists?: boolean },
    context: { sessionId: string; requestId?: string; rootUserMessage: string },
  ): Promise<BacktestJobSubmissionResult> {
    const current = await this.portfolioStore.load();
    const input: BacktestCurrentPortfolioJobInput = {
      kind: "current_portfolio",
      ...params,
      initialPortfolioSnapshot: current,
    };
    return this.submitJob(input, context);
  }

  async getSessionJobsSnapshot(sessionId: string, limit?: number): Promise<BacktestSessionJobsSnapshot> {
    return this.jobs.getSessionSnapshot(sessionId, limit);
  }

  async getGlobalJobCounts(): Promise<BacktestJobCounts> {
    return this.jobs.getGlobalCounts();
  }

  private async submitJob(
    input: BacktestJobInput,
    context: { sessionId: string; requestId?: string; rootUserMessage: string },
  ): Promise<BacktestJobSubmissionResult> {
    const existingSession = await this.sessions.getSession(context.sessionId);
    const submittedAt = new Date().toISOString();
    const symbols = resolveJobSymbols(input);
    const jobId = randomUUID();
    const job: BacktestJob = {
      jobId,
      parentSessionId: context.sessionId,
      parentUserId: existingSession?.userId ?? inferSessionUserId(context.sessionId),
      parentChannel: existingSession?.channel ?? inferChannel(context.sessionId),
      requestId: context.requestId ?? null,
      status: "queued",
      input,
      rootUserMessage: context.rootUserMessage.trim() || `Backtest ${symbols.join(", ") || "portfolio"} from ${input.dateFrom} to ${input.dateTo}.`,
      symbols,
      runId: null,
      datasetId: null,
      warnings: [],
      report: null,
      error: null,
      submittedAt,
      startedAt: null,
      completedAt: null,
      sessionAppendedAt: null,
      channelDeliveredAt: null,
      deliveredAt: null,
      nextDeliveryAttemptAt: null,
      deliveryAttemptCount: 0,
      deliveryError: null,
      tracePath: this.artifacts.tracePathFor(jobId),
      reportPath: this.artifacts.reportPathFor(jobId),
    };
    await this.jobs.saveSubmittedJob(job);
    await this.artifacts.appendTrace(job.jobId, {
      timestamp: submittedAt,
      jobId: job.jobId,
      runId: null,
      level: "info",
      type: "job_submitted",
      data: {
        kind: input.kind,
        symbols: [...symbols],
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
        parentSessionId: context.sessionId,
      },
    });
    this.schedulePump();
    return {
      jobId: job.jobId,
      parentSessionId: job.parentSessionId,
      status: "queued",
      kind: input.kind,
      symbols: [...job.symbols],
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
      submittedAt,
      note: buildBacktestJobSubmissionNote({
        jobId: job.jobId,
        kind: input.kind,
        symbols: job.symbols,
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
      }),
    };
  }

  private schedulePump(): void {
    if (this.closed) {
      return;
    }
    queueMicrotask(() => {
      void this.pump().catch((error) => {
        console.warn(`stock-claw backtest worker error: ${String(error)}`);
      });
    });
  }

  private async pump(): Promise<void> {
    if (this.closed || this.pumpInFlight) {
      return;
    }
    if (!(await this.ensureWorkerOwnership())) {
      return;
    }
    this.pumpInFlight = true;
    try {
      while (!this.closed && this.processing.size < this.maxConcurrency) {
        const pending = await this.jobs.listPendingWork(this.maxConcurrency * 4);
        const next = pending.find((job) => !this.processing.has(job.jobId));
        if (!next) {
          break;
        }
        const task = this.processJob(next.jobId)
          .catch((error) => {
            console.warn(`stock-claw backtest job ${next.jobId} crashed: ${String(error)}`);
          })
          .finally(() => {
            this.processing.delete(next.jobId);
            if (!this.closed) {
              this.schedulePump();
            }
          });
        this.processing.set(next.jobId, task);
      }
    } finally {
      this.pumpInFlight = false;
    }
  }

  private async ensureWorkerOwnership(): Promise<boolean> {
    if (this.workerOwned) {
      return true;
    }
    const lock = await this.workerLock.acquire(this.workerOwnerId);
    if (!lock.acquired) {
      return false;
    }
    this.workerOwned = true;
    return true;
  }

  private startPoller(): void {
    if (this.pollTimer || this.closed) {
      return;
    }
    this.pollTimer = setInterval(() => {
      this.schedulePump();
    }, this.workerPollIntervalMs);
    this.pollTimer.unref?.();
  }

  private stopPoller(): void {
    if (!this.pollTimer) {
      return;
    }
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  private async processJob(jobId: string): Promise<void> {
    let job = await this.jobs.getJob(jobId);
    if (!job) {
      return;
    }
    let trace = this.createJobTrace(job);

    if ((job.status === "completed" || job.status === "failed") && !job.deliveredAt) {
      await this.tryDeliver(job, trace);
      return;
    }

    try {
      if (job.status === "queued") {
        job = await this.jobs.updateJob(jobId, (current) => ({
          ...current,
          status: "preparing",
          startedAt: current.startedAt ?? new Date().toISOString(),
          error: null,
        }));
        trace = this.createJobTrace(job);
        await trace.log({
          type: "job_started",
          data: {
            status: job.status,
          },
        });
      }

      if (!job.runId) {
        const prepared = await this.prepareFromJob(job, trace);
        job = await this.jobs.updateJob(jobId, (current) => ({
          ...current,
          status: "running",
          runId: prepared.runId,
          datasetId: prepared.datasetId,
          symbols: [...prepared.symbols],
          warnings: dedupeStrings([...current.warnings, ...prepared.warnings]),
          error: null,
          startedAt: current.startedAt ?? new Date().toISOString(),
        }));
        trace = this.createJobTrace(job);
        await trace.log({
          type: "dataset_prepared",
          data: {
            runId: prepared.runId,
            datasetId: prepared.datasetId,
            provider: prepared.provider,
            tradingDays: prepared.tradingDays,
            warnings: prepared.warnings,
          },
        });
      } else if (job.status !== "running") {
        job = await this.jobs.updateJob(jobId, (current) => ({
          ...current,
          status: "running",
          startedAt: current.startedAt ?? new Date().toISOString(),
          error: null,
        }));
        trace = this.createJobTrace(job);
      }

      const runId = job.runId;
      if (!runId) {
        throw new Error(`Backtest job ${jobId} did not resolve a run id after preparation.`);
      }
      const result = await this.runDataset(runId, { trace });
      job = await this.jobs.updateJob(jobId, (current) => ({
        ...current,
        status: result.status,
        runId: result.runId,
        datasetId: result.datasetId,
        symbols: [...result.report.symbols],
        report: result.report,
        warnings: dedupeStrings([...current.warnings, ...result.report.warnings]),
        error: result.status === "failed" ? (result.error ?? current.error ?? result.report.summary) : null,
        startedAt: current.startedAt ?? result.report.startedAt,
        completedAt: result.report.completedAt,
      }));
      trace = this.createJobTrace(job);
      const run = await this.store.getRun(runId);
      if (run) {
        const reportPath = await this.artifacts.writeMarkdownReport(
          job.jobId,
          buildBacktestMarkdownReport({
            job,
            run,
            tracePath: job.tracePath,
          }),
        );
        job = await this.jobs.updateJob(jobId, (current) => ({
          ...current,
          reportPath,
        }));
        trace = this.createJobTrace(job);
        await trace.log({
          type: "report_written",
          data: {
            reportPath,
            tracePath: job.tracePath,
          },
        });
      }
      await this.tryDeliver(job, trace);
    } catch (error) {
      const failedAt = new Date().toISOString();
      job = await this.jobs.updateJob(jobId, (current) => ({
        ...current,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        startedAt: current.startedAt ?? failedAt,
        completedAt: failedAt,
      }));
      trace = this.createJobTrace(job);
      await trace.log({
        level: "error",
        type: "job_failed",
        data: {
          error: job.error,
        },
      });
      const reportPath = await this.artifacts.writeMarkdownReport(
        job.jobId,
        buildBacktestJobResultMarkdown(job),
      );
      job = await this.jobs.updateJob(jobId, (current) => ({
        ...current,
        reportPath,
      }));
      trace = this.createJobTrace(job);
      await trace.log({
        type: "report_written",
        data: {
          reportPath,
          tracePath: job.tracePath,
          failed: true,
        },
      });
      await this.tryDeliver(job, trace);
    }
  }

  private async tryDeliver(job: BacktestJob, trace = this.createJobTrace(job)): Promise<void> {
    if (job.deliveredAt) {
      return;
    }
    try {
      await trace.log({
        type: "delivery_attempt",
        data: {
          sessionAppendedAt: job.sessionAppendedAt,
          channelDeliveredAt: job.channelDeliveredAt,
          reportPath: job.reportPath,
        },
      });
      let current = job;
      if (!current.sessionAppendedAt) {
        const sessionAppendedAt = await this.notifier.appendJobResult(current);
        current = await this.jobs.updateJob(current.jobId, (stored) => ({
          ...stored,
          sessionAppendedAt: stored.sessionAppendedAt ?? sessionAppendedAt,
          nextDeliveryAttemptAt: null,
          deliveryError: null,
        }));
      }

      if (current.parentChannel === "telegram" && !current.channelDeliveredAt) {
        const channelDeliveredAt = await this.notifier.sendChannelNotice(current);
        current = await this.jobs.updateJob(current.jobId, (stored) => ({
          ...stored,
          channelDeliveredAt: stored.channelDeliveredAt ?? channelDeliveredAt,
          deliveryAttemptCount: stored.deliveryAttemptCount + 1,
          nextDeliveryAttemptAt: null,
          deliveryError: null,
        }));
      }

      if (!current.sessionAppendedAt) {
        return;
      }
      if (current.parentChannel === "telegram" && !current.channelDeliveredAt) {
        return;
      }
      await this.jobs.updateJob(current.jobId, (stored) => ({
        ...stored,
        deliveredAt: stored.deliveredAt ?? latestTimestamp([
          stored.sessionAppendedAt,
          stored.channelDeliveredAt,
          new Date().toISOString(),
        ]),
        nextDeliveryAttemptAt: null,
        deliveryError: null,
      }));
      await trace.log({
        type: "delivery_succeeded",
        data: {
          deliveredAt: new Date().toISOString(),
          channel: current.parentChannel,
        },
      });
    } catch (error) {
      await this.jobs.updateJob(job.jobId, (current) => ({
        ...current,
        deliveryAttemptCount: current.deliveryAttemptCount + 1,
        nextDeliveryAttemptAt: new Date(Date.now() + this.deliveryRetryDelayMs).toISOString(),
        deliveryError: error instanceof Error ? error.message : String(error),
      }));
      await trace.log({
        level: "warn",
        type: "delivery_failed",
        data: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
      console.warn(`stock-claw backtest delivery failed for ${job.jobId}: ${String(error)}`);
    }
  }

  private createJobTrace(job: Pick<BacktestJob, "jobId" | "runId">): BacktestTraceSink {
    return this.artifacts.createTraceSink({
      artifactId: job.jobId,
      jobId: job.jobId,
      runId: job.runId,
    });
  }

  private async prepareFromJob(job: BacktestJob, trace: BacktestTraceSink | null = null): Promise<BacktestPrepareResult> {
    if (job.input.kind === "asset") {
      return this.prepare(
        {
          kind: "asset",
          dateFrom: job.input.dateFrom,
          dateTo: job.input.dateTo,
          executionPolicy: executionPolicyFrom(job.input),
          initialPortfolio: createInitialBacktestPortfolio({
            accountId: "backtest",
            mode: "backtest",
            cash: job.input.initialCash,
            equity: job.input.initialCash,
            buyingPower: job.input.initialCash,
            positions: [],
            openOrders: [],
            updatedAt: "",
          }),
          symbols: [normalizeSymbol(job.input.symbol)],
          sessionId: job.parentSessionId,
          rootUserMessage: job.rootUserMessage,
        },
        trace,
      );
    }
    if (job.input.kind === "portfolio") {
      const positions = job.input.positions.map((position) => ({
        symbol: normalizeSymbol(position.symbol),
        quantity: position.quantity,
        avgCost: position.avgCost ?? position.marketPrice ?? 0,
        marketPrice: position.marketPrice ?? position.avgCost ?? null,
        marketValue:
          position.marketValue ??
          ((position.marketPrice ?? position.avgCost) != null
            ? position.quantity * (position.marketPrice ?? position.avgCost ?? 0)
            : null),
        currency: position.currency ?? "USD",
      }));
      return this.prepare(
        {
          kind: "portfolio",
          dateFrom: job.input.dateFrom,
          dateTo: job.input.dateTo,
          executionPolicy: executionPolicyFrom(job.input),
          initialPortfolio: createInitialBacktestPortfolio({
            accountId: "backtest",
            mode: "backtest",
            cash: job.input.cash,
            equity: job.input.cash,
            buyingPower: job.input.cash,
            positions,
            openOrders: [],
            updatedAt: "",
          }),
          symbols: positions.map((position) => position.symbol),
          sessionId: job.parentSessionId,
          rootUserMessage: job.rootUserMessage,
        },
        trace,
      );
    }
    const currentPortfolio = createInitialBacktestPortfolio({
      ...(job.input.initialPortfolioSnapshot ?? await this.portfolioStore.load()),
      mode: "backtest",
    });
    return this.prepare(
      {
        kind: "current_portfolio",
        dateFrom: job.input.dateFrom,
        dateTo: job.input.dateTo,
        executionPolicy: executionPolicyFrom(job.input),
        initialPortfolio: currentPortfolio,
        symbols: currentPortfolio.positions.map((position) => normalizeSymbol(position.symbol)),
        sessionId: job.parentSessionId,
        rootUserMessage: job.rootUserMessage,
      },
      trace,
    );
  }

  private async prepare(params: {
    kind: BacktestEntryKind;
    dateFrom: string;
    dateTo: string;
    executionPolicy: BacktestExecutionPolicy;
    initialPortfolio: PortfolioSnapshot;
    symbols: string[];
    sessionId: string;
    rootUserMessage: string;
  }, trace: BacktestTraceSink | null = null): Promise<BacktestPrepareResult> {
    if (params.symbols.length === 0) {
      throw new Error("Backtest preparation requires at least one symbol.");
    }
    const preparedMarketData = await this.preparer.prepare({
      kind: params.kind,
      sessionId: params.sessionId,
      rootUserMessage: params.rootUserMessage,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      symbols: params.symbols,
      executionPolicy: params.executionPolicy,
      trace,
    });
    const { provider, barsBySymbol, calendar, warnings } = preparedMarketData;
    const initialPortfolio = markInitialPortfolioToMarket(params.initialPortfolio, barsBySymbol, calendar[0] ?? null);
    const runId = randomUUID();
    const datasetId = randomUUID();
    const preparedAt = new Date().toISOString();
    const dataset: BacktestDataset = {
      datasetId,
      runId,
      kind: params.kind,
      preparedBySessionId: params.sessionId,
      parentSessionId: params.sessionId,
      rootUserMessage: params.rootUserMessage.trim() || `Backtest ${params.symbols.join(", ")} from ${params.dateFrom} to ${params.dateTo}.`,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      symbols: [...params.symbols],
      provider,
      executionPolicy: params.executionPolicy,
      initialPortfolio,
      barsBySymbol,
      calendar,
      warnings,
      preparedAt,
    };
    const run: BacktestRun = {
      runId,
      datasetId,
      parentSessionId: params.sessionId,
      status: "prepared",
      kind: params.kind,
      dataset,
      decisionSessions: [],
      contextSnapshots: [],
      fills: [],
      portfolioSnapshots: [],
      report: null,
      error: null,
      preparedAt,
      startedAt: null,
      completedAt: null,
    };
    await this.store.savePreparedRun(run);
    return {
      runId,
      datasetId,
      kind: params.kind,
      parentSessionId: params.sessionId,
      symbols: [...params.symbols],
      provider,
      tradingDays: calendar.length,
      calendar,
      warnings,
    };
  }
}

function executionPolicyFrom(params: {
  feesBps?: number;
  slippageBps?: number;
  spawnSpecialists?: boolean;
}): BacktestExecutionPolicy {
  return {
    buyPrice: "open",
    sellPrice: "close",
    feesBps: finiteOrZero(params.feesBps),
    slippageBps: finiteOrZero(params.slippageBps),
    spawnSpecialists: params.spawnSpecialists !== false,
    maxLookbackBars: 120,
  };
}

function resolveJobSymbols(input: BacktestJobInput): string[] {
  if (input.kind === "asset") {
    return [normalizeSymbol(input.symbol)];
  }
  if (input.kind === "portfolio") {
    return input.positions.map((position) => normalizeSymbol(position.symbol));
  }
  return (input.initialPortfolioSnapshot?.positions ?? []).map((position) => normalizeSymbol(position.symbol));
}

function inferSessionUserId(sessionId: string): string {
  if (sessionId.startsWith("telegram:")) {
    return `telegram:${sessionId.slice("telegram:".length)}`;
  }
  return `session:${sessionId}`;
}

function inferChannel(sessionId: string): "web" | "telegram" {
  return sessionId.startsWith("telegram:") ? "telegram" : "web";
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim()))];
}

function latestTimestamp(values: Array<string | null>): string {
  return values
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => left.localeCompare(right))
    .at(-1) ?? new Date().toISOString();
}

function finiteOrZero(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function markInitialPortfolioToMarket(
  portfolio: PortfolioSnapshot,
  barsBySymbol: Record<string, BacktestHistoricalBar[]>,
  firstTradingDate: string | null,
): PortfolioSnapshot {
  if (!firstTradingDate) {
    return portfolio;
  }
  const positions = portfolio.positions.map((position) => {
    const firstBar =
      barsBySymbol[position.symbol]?.find((bar) => bar.date === firstTradingDate) ??
      barsBySymbol[position.symbol]?.[0] ??
      null;
    const openingPrice = firstBar?.open ?? null;
    const resolvedAvgCost =
      Number.isFinite(position.avgCost) && position.avgCost > 0 ? position.avgCost : openingPrice ?? 0;
    return {
      ...position,
      avgCost: resolvedAvgCost,
      marketPrice: openingPrice,
      marketValue: openingPrice == null ? null : roundCurrency(position.quantity * openingPrice),
    };
  });
  const equity = roundCurrency(
    portfolio.cash + positions.reduce((sum, position) => sum + (position.marketValue ?? 0), 0),
  );
  return {
    ...portfolio,
    positions,
    equity,
    buyingPower: roundCurrency(portfolio.cash),
  };
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
