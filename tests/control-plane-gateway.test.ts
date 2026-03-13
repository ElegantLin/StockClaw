import { describe, expect, it, vi } from "vitest";

import { ControlPlaneGateway } from "../src/control-plane/gateway.js";

describe("ControlPlaneGateway", () => {
  it("delegates configuration and ops calls through one facade", async () => {
    const config = {
      getSnapshot: vi.fn().mockResolvedValue({ target: "all" }),
      patchConfig: vi.fn().mockResolvedValue({ target: "mcp" }),
      applyConfig: vi.fn().mockResolvedValue({ target: "llm" }),
    };
    const ops = {
      installMcp: vi.fn().mockResolvedValue({ ok: true, action: "install_mcp", message: "ok" }),
      installSkill: vi.fn().mockResolvedValue({ ok: true, action: "install_skill", message: "ok" }),
      verifyRuntime: vi.fn().mockResolvedValue({ ok: true, action: "verify_runtime", message: "ok" }),
    };
    const runtime = {
      getStatus: vi.fn().mockReturnValue({ reloadCount: 1 }),
      inspect: vi.fn().mockResolvedValue({ status: { reloadCount: 1 } }),
      reloadNow: vi.fn().mockResolvedValue({ reloadCount: 2 }),
    };
    const restart = {
      requestRestart: vi.fn().mockResolvedValue({
        ok: true,
        action: "restart_runtime",
        message: "scheduled",
        details: {
          sessionId: "web:test",
          channel: "web",
          note: "scheduled",
          reason: null,
          requestedAt: "2026-03-09T00:00:00.000Z",
        },
      }),
    };
    const gateway = new ControlPlaneGateway(config as never, ops as never, restart as never, runtime as never);

    expect(await gateway.getConfig()).toEqual({ target: "all" });
    expect(await gateway.patchConfig("mcp", '{"mcpServers":{}}')).toEqual({ target: "mcp" });
    expect(await gateway.applyConfig("llm", "raw")).toEqual({ target: "llm" });
    expect(
      await gateway.installMcp({ name: "exa", command: "uvx", args: ["exa-mcp"] }),
    ).toMatchObject({ ok: true, action: "install_mcp" });
    expect(await gateway.installSkill({ source: "repo" })).toMatchObject({
      ok: true,
      action: "install_skill",
    });
    expect(await gateway.verifyRuntime()).toMatchObject({ ok: true, action: "verify_runtime" });
    expect(
      await gateway.requestRestart({
        sessionId: "web:test",
        channel: "web",
        note: "scheduled",
      }),
    ).toMatchObject({ ok: true, action: "restart_runtime" });
    expect(gateway.getRuntimeStatus()).toEqual({ reloadCount: 1 });
    expect(await gateway.inspectRuntime(4)).toEqual({ status: { reloadCount: 1 } });
    expect(await gateway.reloadRuntime("test")).toEqual({ reloadCount: 2 });
  });

  it("delegates cron operations through the same facade", async () => {
    const gateway = new ControlPlaneGateway(
      {} as never,
      {} as never,
      undefined,
      undefined,
      {
        inspect: vi.fn().mockResolvedValue({
          status: {
            enabled: true,
            jobCount: 1,
            activeJobCount: 1,
            runningJobCount: 0,
            lastTickAt: null,
          },
          jobs: [],
        }),
        listJobs: vi.fn().mockResolvedValue([{ id: "job-1", name: "watch-aapl" }]),
        addJob: vi.fn().mockResolvedValue({ id: "job-2", name: "review" }),
        updateJob: vi.fn().mockResolvedValue({ id: "job-2", name: "review-updated" }),
        removeJob: vi.fn().mockResolvedValue({ ok: true, jobId: "job-2" }),
        runJob: vi.fn().mockResolvedValue({ jobId: "job-2", status: "succeeded" }),
      } as never,
    );

    expect(await gateway.inspectCron()).toMatchObject({
      status: { enabled: true, jobCount: 1 },
    });
    expect(await gateway.listCronJobs()).toEqual([{ id: "job-1", name: "watch-aapl" }]);
    expect(await gateway.addCronJob({} as never)).toEqual({ id: "job-2", name: "review" });
    expect(await gateway.updateCronJob("job-2", {})).toEqual({ id: "job-2", name: "review-updated" });
    expect(await gateway.removeCronJob("job-2")).toEqual({ ok: true, jobId: "job-2" });
    expect(await gateway.runCronJob("job-2")).toEqual({ jobId: "job-2", status: "succeeded" });
  });
});
