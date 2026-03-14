import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { AppSessionStore } from "../src/state/app-session-store.js";

describe("AppSessionStore", () => {
  it("persists transcript and last result", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-sessions-"));
    const store = new AppSessionStore(path.join(dir, "sessions.json"));

    await store.createOrLoad({
      sessionId: "session-1",
      userId: "user-1",
      channel: "web",
      now: "2026-03-08T00:00:00.000Z",
    });
    await store.appendUserMessage({
      sessionId: "session-1",
      content: "Analyze AAPL",
      timestamp: "2026-03-08T00:00:01.000Z",
    });
    await store.appendAssistantResult({
      sessionId: "session-1",
      intent: "investment_research",
      timestamp: "2026-03-08T00:00:02.000Z",
      response: {
        requestId: "req-1",
        sessionId: "session-1",
        message: "Research complete",
        blocks: [],
        actions: [],
      },
    });

    const loaded = await store.get("session-1");
    expect(loaded?.transcript).toHaveLength(2);
    expect(loaded?.lastIntent).toBe("investment_research");
    expect(loaded?.lastResult?.message).toBe("Research complete");
    expect(loaded?.sessionSummary).toBeNull();
    expect(loaded?.sessionSummaryUpdatedAt).toBeNull();
  });

  it("serializes concurrent updates against the same file path", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-sessions-"));
    const filePath = path.join(dir, "sessions.json");
    const first = new AppSessionStore(filePath);
    const second = new AppSessionStore(filePath);

    await first.createOrLoad({
      sessionId: "session-1",
      userId: "user-1",
      channel: "web",
      now: "2026-03-08T00:00:00.000Z",
    });

    await Promise.all([
      first.appendUserMessage({
        sessionId: "session-1",
        content: "Message one",
        timestamp: "2026-03-08T00:00:01.000Z",
      }),
      second.appendUserMessage({
        sessionId: "session-1",
        content: "Message two",
        timestamp: "2026-03-08T00:00:02.000Z",
      }),
    ]);

    const loaded = await first.get("session-1");
    expect(loaded?.transcript).toHaveLength(2);
    expect(loaded?.transcript.map((entry) => entry.content).sort()).toEqual(["Message one", "Message two"]);
  });

  it("tracks daily usage by Asia/Shanghai date and resets at Beijing midnight", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-sessions-"));
    const store = new AppSessionStore(path.join(dir, "sessions.json"));

    await store.createOrLoad({
      sessionId: "session-1",
      userId: "user-1",
      channel: "web",
      now: "2026-03-13T15:50:00.000Z",
    });

    await store.appendAssistantResult({
      sessionId: "session-1",
      intent: "chat",
      timestamp: "2026-03-13T15:55:00.000Z",
      response: {
        requestId: "req-1",
        sessionId: "session-1",
        message: "before midnight",
        blocks: [],
        actions: [],
      },
      usage: {
        turns: 1,
        input: 100,
        output: 50,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 150,
        contextTokens: 150,
        cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 },
      },
    });

    await store.appendAssistantResult({
      sessionId: "session-1",
      intent: "chat",
      timestamp: "2026-03-13T15:59:30.000Z",
      response: {
        requestId: "req-2",
        sessionId: "session-1",
        message: "still same Beijing day",
        blocks: [],
        actions: [],
      },
      usage: {
        turns: 1,
        input: 20,
        output: 10,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 30,
        contextTokens: 30,
        cost: { input: 0.0002, output: 0.0001, cacheRead: 0, cacheWrite: 0, total: 0.0003 },
      },
    });

    let loaded = await store.get("session-1");
    expect(loaded?.dailyUsageDate).toBe("2026-03-13");
    expect(loaded?.dailyUsage.turns).toBe(2);
    expect(loaded?.dailyUsage.totalTokens).toBe(180);

    await store.appendAssistantResult({
      sessionId: "session-1",
      intent: "chat",
      timestamp: "2026-03-13T16:01:00.000Z",
      response: {
        requestId: "req-3",
        sessionId: "session-1",
        message: "after midnight in Beijing",
        blocks: [],
        actions: [],
      },
      usage: {
        turns: 1,
        input: 7,
        output: 8,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 15,
        contextTokens: 15,
        cost: { input: 0.0001, output: 0.0001, cacheRead: 0, cacheWrite: 0, total: 0.0002 },
      },
    });

    loaded = await store.get("session-1");
    expect(loaded?.dailyUsageDate).toBe("2026-03-14");
    expect(loaded?.dailyUsage.turns).toBe(1);
    expect(loaded?.dailyUsage.totalTokens).toBe(15);
    expect(loaded?.cumulativeUsage.turns).toBe(3);
    expect(loaded?.cumulativeUsage.totalTokens).toBe(195);
  });
});
