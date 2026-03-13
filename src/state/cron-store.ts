import type { CronJob } from "../cron/types.js";
import { JsonFileStore } from "./json-file-store.js";

interface CronStoreFile {
  version: 1;
  jobs: CronJob[];
}

const EMPTY_STORE: CronStoreFile = {
  version: 1,
  jobs: [],
};

export class CronStore extends JsonFileStore<CronStoreFile> {
  constructor(filePath: string = "data/cron-jobs.json") {
    super(filePath);
  }

  async list(): Promise<CronJob[]> {
    return this.snapshot((store) => [...store.jobs]);
  }

  async get(jobId: string): Promise<CronJob | null> {
    return this.snapshot((store) => store.jobs.find((job) => job.id === jobId) ?? null);
  }

  async saveAll(jobs: CronJob[]): Promise<void> {
    await this.overwriteState({
      version: 1,
      jobs,
    });
  }

  protected defaultState(): CronStoreFile {
    return structuredClone(EMPTY_STORE);
  }

  protected normalizeState(raw: unknown): CronStoreFile {
    const parsed = raw && typeof raw === "object" ? (raw as Partial<CronStoreFile>) : {};
    if (parsed.version !== 1 || !Array.isArray(parsed.jobs)) {
      return structuredClone(EMPTY_STORE);
    }
    return {
      version: 1,
      jobs: parsed.jobs as CronJob[],
    };
  }
}
