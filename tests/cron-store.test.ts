import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { CronStore } from "../src/state/cron-store.js";
import type { CronJob } from "../src/cron/types.js";

describe("CronStore", () => {
  it("persists scheduled jobs to disk", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-cron-store-"));
    const store = new CronStore(path.join(dir, "cron-jobs.json"));
    const job: CronJob = {
      id: "job-1",
      name: "watch-aapl",
      enabled: true,
      trigger: { kind: "every", everyMs: 60_000 },
      action: { kind: "notify", message: "AAPL check" },
      target: { sessionId: "telegram:1", channel: "telegram", userId: "telegram:1" },
      createdAt: "2026-03-09T00:00:00.000Z",
      updatedAt: "2026-03-09T00:00:00.000Z",
      state: {
        nextRunAt: "2026-03-09T00:01:00.000Z",
        lastRunAt: null,
        lastOutcome: "idle",
        lastError: null,
        runCount: 0,
        lastObservedPrice: null,
      },
    };

    await store.saveAll([job]);

    expect(await store.list()).toEqual([job]);
    expect(await store.get("job-1")).toEqual(job);
  });
});
