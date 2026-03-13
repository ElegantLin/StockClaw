import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { BacktestJob, BacktestJobCounts, BacktestJobStatus, BacktestJobSummary, BacktestSessionJobsSnapshot } from "../backtest/types.js";
import { JsonFileStore } from "./json-file-store.js";

interface BacktestJobIndexState {
  version: 1;
  jobs: BacktestJobSummary[];
}

const EMPTY_COUNTS: BacktestJobCounts = {
  queued: 0,
  preparing: 0,
  running: 0,
  completed: 0,
  failed: 0,
  active: 0,
};

const EMPTY_STATE: BacktestJobIndexState = {
  version: 1,
  jobs: [],
};

export class BacktestJobStore extends JsonFileStore<BacktestJobIndexState> {
  constructor(
    filePath: string = "data/backtest-jobs.json",
    private readonly jobRoot: string = "data/backtest-jobs",
  ) {
    super(filePath);
  }

  async list(): Promise<BacktestJobSummary[]> {
    return this.snapshot((state) => [...state.jobs].sort((left, right) => right.submittedAt.localeCompare(left.submittedAt)));
  }

  async listPendingWork(limit = 50): Promise<BacktestJobSummary[]> {
    const now = new Date().toISOString();
    return this.snapshot((state) =>
      state.jobs
        .filter((job) =>
          job.status === "queued" ||
          job.status === "preparing" ||
          job.status === "running" ||
          (
            (job.status === "completed" || job.status === "failed") &&
            !job.deliveredAt &&
            (!job.nextDeliveryAttemptAt || job.nextDeliveryAttemptAt <= now)
          ),
        )
        .sort((left, right) => left.submittedAt.localeCompare(right.submittedAt))
        .slice(0, limit),
    );
  }

  async listBySession(sessionId: string, limit?: number): Promise<BacktestJobSummary[]> {
    return this.snapshot((state) => {
      const jobs = state.jobs
        .filter((job) => job.parentSessionId === sessionId)
        .sort((left, right) => right.submittedAt.localeCompare(left.submittedAt));
      return typeof limit === "number" ? jobs.slice(0, limit) : jobs;
    });
  }

  async getJob(jobId: string): Promise<BacktestJob | null> {
    try {
      const raw = await readFile(this.resolveJobPath(jobId), "utf8");
      return normalizeJob(JSON.parse(raw) as BacktestJob);
    } catch {
      return null;
    }
  }

  async saveSubmittedJob(job: BacktestJob): Promise<void> {
    await this.writeJob(job);
    await this.updateSummary(job);
  }

  async updateJob(jobId: string, updater: (job: BacktestJob) => BacktestJob | Promise<BacktestJob>): Promise<BacktestJob> {
    const current = await this.getJob(jobId);
    if (!current) {
      throw new Error(`Unknown backtest job '${jobId}'.`);
    }
    const next = await updater(current);
    await this.writeJob(next);
    await this.updateSummary(next);
    return next;
  }

  async getSessionSnapshot(sessionId: string, limit = 8): Promise<BacktestSessionJobsSnapshot> {
    const allJobs = await this.listBySession(sessionId);
    return {
      counts: countJobs(allJobs),
      jobs: typeof limit === "number" ? allJobs.slice(0, limit) : allJobs,
    };
  }

  async getGlobalCounts(): Promise<BacktestJobCounts> {
    return this.snapshot((state) => countJobs(state.jobs));
  }

  protected defaultState(): BacktestJobIndexState {
    return structuredClone(EMPTY_STATE);
  }

  protected normalizeState(raw: unknown): BacktestJobIndexState {
    const parsed = raw && typeof raw === "object" ? (raw as Partial<BacktestJobIndexState>) : {};
    if (parsed.version !== 1 || !Array.isArray(parsed.jobs)) {
      return structuredClone(EMPTY_STATE);
    }
    return {
      version: 1,
      jobs: parsed.jobs.map((job) => normalizeSummary(job as BacktestJobSummary)),
    };
  }

  private async updateSummary(job: BacktestJob): Promise<void> {
    const summary = toSummary(job);
    await this.updateState((state) => {
      const existingIndex = state.jobs.findIndex((item) => item.jobId === job.jobId);
      if (existingIndex >= 0) {
        state.jobs[existingIndex] = summary;
      } else {
        state.jobs.push(summary);
      }
      return undefined;
    });
  }

  private resolveJobPath(jobId: string): string {
    return path.resolve(this.jobRoot, `${jobId}.json`);
  }

  private async writeJob(job: BacktestJob): Promise<void> {
    const target = this.resolveJobPath(job.jobId);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(job, null, 2)}\n`, "utf8");
  }
}

function toSummary(job: BacktestJob): BacktestJobSummary {
  return normalizeSummary({
    jobId: job.jobId,
    parentSessionId: job.parentSessionId,
    status: job.status,
    kind: job.input.kind,
    symbols: [...job.symbols],
    dateFrom: job.input.dateFrom,
    dateTo: job.input.dateTo,
    runId: job.runId,
    datasetId: job.datasetId,
    submittedAt: job.submittedAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    sessionAppendedAt: job.sessionAppendedAt,
    channelDeliveredAt: job.channelDeliveredAt,
    deliveredAt: job.deliveredAt,
    nextDeliveryAttemptAt: job.nextDeliveryAttemptAt,
    deliveryAttemptCount: job.deliveryAttemptCount,
    deliveryError: job.deliveryError,
    tracePath: job.tracePath,
    reportPath: job.reportPath,
    reportSummary: job.report?.summary ?? null,
    error: job.error,
  });
}

function normalizeJob(job: BacktestJob): BacktestJob {
  return {
    ...job,
    sessionAppendedAt: job.sessionAppendedAt ?? null,
    channelDeliveredAt: job.channelDeliveredAt ?? null,
    deliveredAt: job.deliveredAt ?? null,
    nextDeliveryAttemptAt: job.nextDeliveryAttemptAt ?? null,
    deliveryAttemptCount: job.deliveryAttemptCount ?? 0,
    deliveryError: job.deliveryError ?? null,
    tracePath: job.tracePath ?? null,
    reportPath: job.reportPath ?? null,
  };
}

function normalizeSummary(job: BacktestJobSummary): BacktestJobSummary {
  return {
    ...job,
    sessionAppendedAt: job.sessionAppendedAt ?? null,
    channelDeliveredAt: job.channelDeliveredAt ?? null,
    deliveredAt: job.deliveredAt ?? null,
    nextDeliveryAttemptAt: job.nextDeliveryAttemptAt ?? null,
    deliveryAttemptCount: job.deliveryAttemptCount ?? 0,
    deliveryError: job.deliveryError ?? null,
    tracePath: job.tracePath ?? null,
    reportPath: job.reportPath ?? null,
  };
}

function countJobs(jobs: BacktestJobSummary[]): BacktestJobCounts {
  const counts = structuredClone(EMPTY_COUNTS);
  for (const job of jobs) {
    increment(counts, job.status);
  }
  counts.active = counts.queued + counts.preparing + counts.running;
  return counts;
}

function increment(counts: BacktestJobCounts, status: BacktestJobStatus): void {
  counts[status] += 1;
}
