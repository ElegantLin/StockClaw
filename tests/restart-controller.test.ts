import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { RestartController } from "../src/restart/controller.js";
import { deliverRestartSentinelOnStartup } from "../src/restart/startup-delivery.js";
import { AppSessionStore } from "../src/state/app-session-store.js";

describe("RestartController", () => {
  it("writes a sentinel and schedules restart execution", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-restart-"));
    const env = {
      ...process.env,
      STOCK_CLAW_RESTART_SENTINEL_PATH: path.join(dir, "restart-sentinel.json"),
    };
    const controller = new RestartController(env);
    const executor = vi.fn(async () => undefined);
    controller.setExecutor(executor);

    const result = await controller.requestRestart({
      sessionId: "telegram:123",
      channel: "telegram",
      note: "Restarted successfully.",
      reason: "config update",
    });

    expect(result.ok).toBe(true);
    const raw = await readFile(env.STOCK_CLAW_RESTART_SENTINEL_PATH, "utf8");
    expect(raw).toContain("\"pending\"");
    expect(raw).toContain("\"sessionId\": \"telegram:123\"");
    expect(raw).toContain("\"channel\": \"telegram\"");
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it("delivers restart sentinel back into a web app session", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-restart-delivery-"));
    const env = {
      ...process.env,
      STOCK_CLAW_RESTART_SENTINEL_PATH: path.join(dir, "restart-sentinel.json"),
      STOCK_CLAW_APP_SESSION_PATH: path.join(dir, "app-sessions.json"),
    };
    const store = new AppSessionStore(env.STOCK_CLAW_APP_SESSION_PATH);
    await store.createOrLoad({
      sessionId: "web:test",
      userId: "web-user",
      channel: "web",
    });
    const controller = new RestartController(env);
    await controller.requestRestart({
      sessionId: "web:test",
      channel: "web",
      note: "stock-claw restarted successfully.",
      reason: "manual",
    });

    await deliverRestartSentinelOnStartup({
      env,
      telegram: null,
      appSessionPath: env.STOCK_CLAW_APP_SESSION_PATH,
    });

    const session = await store.get("web:test");
    expect(session?.lastResult?.message).toContain("stock-claw restarted successfully.");
    expect(session?.transcript.at(-1)?.content).toContain("stock-claw restarted successfully.");
  });

  it("delivers multiple queued restart sentinels on startup", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-restart-queue-"));
    const env = {
      ...process.env,
      STOCK_CLAW_RESTART_SENTINEL_PATH: path.join(dir, "restart-sentinel.json"),
      STOCK_CLAW_APP_SESSION_PATH: path.join(dir, "app-sessions.json"),
    };
    const store = new AppSessionStore(env.STOCK_CLAW_APP_SESSION_PATH);
    await store.createOrLoad({
      sessionId: "web:first",
      userId: "first-user",
      channel: "web",
    });
    await store.createOrLoad({
      sessionId: "web:second",
      userId: "second-user",
      channel: "web",
    });

    const controller = new RestartController(env);
    await controller.requestRestart({
      sessionId: "web:first",
      channel: "web",
      note: "First restart complete.",
      reason: "config patch",
    });
    await controller.requestRestart({
      sessionId: "web:second",
      channel: "web",
      note: "Second restart complete.",
      reason: "skill install",
    });

    await deliverRestartSentinelOnStartup({
      env,
      telegram: null,
      appSessionPath: env.STOCK_CLAW_APP_SESSION_PATH,
    });

    const first = await store.get("web:first");
    const second = await store.get("web:second");
    expect(first?.lastResult?.message).toContain("First restart complete.");
    expect(second?.lastResult?.message).toContain("Second restart complete.");

    const raw = await readFile(env.STOCK_CLAW_RESTART_SENTINEL_PATH, "utf8");
    expect(raw).toContain("\"pending\": []");
  });
});
