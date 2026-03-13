import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { BacktestRun, BacktestRunSummary, BacktestRunStatus } from "../backtest/types.js";
import { JsonFileStore } from "./json-file-store.js";

interface BacktestIndexState {
  version: 1;
  runs: BacktestRunSummary[];
}

const EMPTY_STATE: BacktestIndexState = {
  version: 1,
  runs: [],
};

export class BacktestStore extends JsonFileStore<BacktestIndexState> {
  constructor(
    filePath: string = "data/backtests.json",
    private readonly runRoot: string = "data/backtest-runs",
  ) {
    super(filePath);
  }

  async list(): Promise<BacktestRunSummary[]> {
    return this.snapshot((state) => [...state.runs].sort((left, right) => right.preparedAt.localeCompare(left.preparedAt)));
  }

  async getRun(runId: string): Promise<BacktestRun | null> {
    try {
      const raw = await readFile(this.resolveRunPath(runId), "utf8");
      return JSON.parse(raw) as BacktestRun;
    } catch {
      return null;
    }
  }

  async savePreparedRun(run: BacktestRun): Promise<void> {
    await this.writeRun(run);
    await this.updateSummary(run);
  }

  async updateRun(runId: string, updater: (run: BacktestRun) => BacktestRun | Promise<BacktestRun>): Promise<BacktestRun> {
    const current = await this.getRun(runId);
    if (!current) {
      throw new Error(`Unknown backtest run '${runId}'.`);
    }
    const next = await updater(current);
    await this.writeRun(next);
    await this.updateSummary(next);
    return next;
  }

  async markStatus(runId: string, status: BacktestRunStatus, timestamp: string, error?: string | null): Promise<BacktestRun> {
    return this.updateRun(runId, (run) => {
      const next: BacktestRun = {
        ...run,
        status,
        startedAt: status === "running" ? (run.startedAt ?? timestamp) : run.startedAt,
        completedAt: status === "completed" || status === "failed" ? timestamp : run.completedAt,
        error: error ?? run.error,
      };
      return next;
    });
  }

  protected defaultState(): BacktestIndexState {
    return structuredClone(EMPTY_STATE);
  }

  protected normalizeState(raw: unknown): BacktestIndexState {
    const parsed = raw && typeof raw === "object" ? (raw as Partial<BacktestIndexState>) : {};
    if (parsed.version !== 1 || !Array.isArray(parsed.runs)) {
      return structuredClone(EMPTY_STATE);
    }
    return {
      version: 1,
      runs: parsed.runs as BacktestRunSummary[],
    };
  }

  private async updateSummary(run: BacktestRun): Promise<void> {
    const summary = toSummary(run);
    await this.updateState((state) => {
      const existingIndex = state.runs.findIndex((item) => item.runId === run.runId);
      if (existingIndex >= 0) {
        state.runs[existingIndex] = summary;
      } else {
        state.runs.push(summary);
      }
      return undefined;
    });
  }

  private resolveRunPath(runId: string): string {
    return path.resolve(this.runRoot, `${runId}.json`);
  }

  private async writeRun(run: BacktestRun): Promise<void> {
    const target = this.resolveRunPath(run.runId);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(run, null, 2)}\n`, "utf8");
  }
}

function toSummary(run: BacktestRun): BacktestRunSummary {
  return {
    runId: run.runId,
    datasetId: run.datasetId,
    parentSessionId: run.parentSessionId,
    status: run.status,
    kind: run.kind,
    symbols: [...run.dataset.symbols],
    dateFrom: run.dataset.dateFrom,
    dateTo: run.dataset.dateTo,
    provider: run.dataset.provider,
    preparedAt: run.preparedAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    reportSummary: run.report?.summary ?? null,
  };
}
