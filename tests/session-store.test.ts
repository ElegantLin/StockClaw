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
});
