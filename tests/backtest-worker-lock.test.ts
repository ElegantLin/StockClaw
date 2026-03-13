import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { BacktestWorkerLock } from "../src/backtest/worker-lock.js";

describe("BacktestWorkerLock", () => {
  it("rejects a second owner inside the same live process", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-worker-lock-"));
    const lock = new BacktestWorkerLock(path.join(dir, "backtest-worker.lock.json"));

    const first = await lock.acquire("owner-a");
    const second = await lock.acquire("owner-b");

    expect(first.acquired).toBe(true);
    expect(second.acquired).toBe(false);
    expect(second.holderPid).toBe(process.pid);
    expect(second.holderOwnerId).toBe("owner-a");

    await lock.release("owner-b");
    const third = await lock.acquire("owner-a");
    expect(third.acquired).toBe(true);

    await lock.release("owner-a");
    const fourth = await lock.acquire("owner-b");
    expect(fourth.acquired).toBe(true);
    expect(fourth.holderPid).toBeNull();
    expect(fourth.holderOwnerId).toBeNull();

    await lock.release("owner-b");
  });
});
