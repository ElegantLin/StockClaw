import type { BacktestTraceSink } from "./artifacts.js";
import type { BacktestDecisionRunner } from "./decision-runner.js";
import { buildBacktestReport } from "./report.js";
import { createInitialBacktestPortfolio } from "./state.js";
import type { BacktestRun, BacktestRunResult } from "./types.js";
import type { BacktestStore } from "../state/backtest-store.js";

export class BacktestEngine {
  constructor(
    private readonly store: BacktestStore,
    private readonly runner: BacktestDecisionRunner,
  ) {}

  async run(run: BacktestRun, trace?: BacktestTraceSink | null): Promise<BacktestRunResult> {
    const startedAt = new Date().toISOString();
    await trace?.log({
      type: "run_started",
      data: {
        runId: run.runId,
        datasetId: run.datasetId,
        tradingDays: run.dataset.calendar.length,
      },
    });
    let working = await this.store.updateRun(run.runId, (current) => ({
      ...current,
      status: "running",
      startedAt,
      completedAt: null,
      error: null,
      report: null,
      decisionSessions: [],
      fills: [],
      portfolioSnapshots: [],
    }));

    let portfolio = createInitialBacktestPortfolio(working.dataset.initialPortfolio);
    try {
      for (const date of working.dataset.calendar) {
        const day = await this.runner.runDay({
          runId: working.runId,
          dataset: working.dataset,
          date,
          portfolio,
          trace,
        });
        portfolio = day.portfolio;
        working = await this.store.updateRun(working.runId, (current) => ({
          ...current,
          decisionSessions: [...current.decisionSessions, day.decisionSession],
          fills: [...current.fills, ...day.fills],
          portfolioSnapshots: [...current.portfolioSnapshots, day.portfolio],
        }));
      }
      const completedAt = new Date().toISOString();
      working = await this.store.updateRun(working.runId, (current) => {
        const completed: BacktestRun = {
          ...current,
          status: "completed",
          completedAt,
        };
        completed.report = buildBacktestReport(completed);
        return completed;
      });
      if (!working.report) {
        throw new Error(`Backtest run ${working.runId} completed without a report.`);
      }
      await trace?.log({
        type: "run_completed",
        data: {
          runId: working.runId,
          report: {
            totalReturnPct: working.report.totalReturnPct,
            maxDrawdownPct: working.report.maxDrawdownPct,
            filledOrders: working.report.filledOrders,
            rejectedOrders: working.report.rejectedOrders,
            endEquity: working.report.endEquity,
          },
        },
      });
      return {
        runId: working.runId,
        datasetId: working.datasetId,
        parentSessionId: working.parentSessionId,
        status: "completed",
        report: working.report,
        error: null,
      };
    } catch (error) {
      const completedAt = new Date().toISOString();
      working = await this.store.updateRun(working.runId, (current) => {
        const failed: BacktestRun = {
          ...current,
          status: "failed",
          completedAt,
          error: error instanceof Error ? error.message : String(error),
        };
        failed.report = buildBacktestReport({
          ...failed,
          status: "failed",
        });
        return failed;
      });
      if (!working.report) {
        throw error;
      }
      await trace?.log({
        level: "error",
        type: "run_failed",
        data: {
          runId: working.runId,
          error: working.error,
          report: {
            filledOrders: working.report.filledOrders,
            rejectedOrders: working.report.rejectedOrders,
          },
        },
      });
      return {
        runId: working.runId,
        datasetId: working.datasetId,
        parentSessionId: working.parentSessionId,
        status: "failed",
        report: working.report,
        error: working.error,
      };
    }
  }
}
