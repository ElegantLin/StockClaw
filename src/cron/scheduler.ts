import type { CronService } from "./service.js";
import type { CronExecutionRecord } from "./types.js";

export class CronScheduler {
  private timer: NodeJS.Timeout | null = null;
  private tickPromise: Promise<CronExecutionRecord[]> | null = null;

  constructor(
    private readonly service: CronService,
    private readonly intervalMs: number = 1_000,
  ) {}

  async start(): Promise<void> {
    if (this.timer) {
      return;
    }
    await this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
  }

  async close(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.tickPromise;
    this.tickPromise = null;
  }

  private async tick(): Promise<CronExecutionRecord[] | void> {
    if (this.tickPromise) {
      return this.tickPromise;
    }
    this.tickPromise = this.service.runDueJobs().catch((error) => {
      console.warn(`stock-claw cron tick failed: ${String(error)}`);
      return [];
    });
    this.tickPromise.finally(() => {
      this.tickPromise = null;
    });
    return this.tickPromise;
  }
}
