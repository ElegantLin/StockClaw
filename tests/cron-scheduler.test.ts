import { describe, expect, it, vi } from "vitest";

import { CronScheduler } from "../src/cron/scheduler.js";

describe("CronScheduler", () => {
  it("ticks the cron service and closes cleanly", async () => {
    const service = {
      runDueJobs: vi.fn(async () => []),
    };
    const scheduler = new CronScheduler(service as never, 10);

    await scheduler.start();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await scheduler.close();

    expect(service.runDueJobs).toHaveBeenCalled();
  });
});
