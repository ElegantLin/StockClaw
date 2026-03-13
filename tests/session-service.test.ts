import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { SessionService } from "../src/sessions/service.js";
import { AppSessionStore } from "../src/state/app-session-store.js";

describe("SessionService", () => {
  it("creates, records, and reloads app sessions", async () => {
    const filePath = path.join(os.tmpdir(), `stock-claw-session-service-${Date.now()}.json`);
    const service = new SessionService(new AppSessionStore(filePath));

    await service.createSession({
      sessionId: "session-1",
      userId: "user-1",
      channel: "web",
      now: "2026-03-08T00:00:00.000Z",
    });

    await service.appendUserMessage({
      requestId: "request-1",
      channel: "web",
      userId: "user-1",
      sessionId: "session-1",
      message: "Analyze AAPL",
      timestamp: "2026-03-08T00:00:01.000Z",
      metadata: {},
    });

    await service.appendAssistantResult({
      sessionId: "session-1",
      intent: "investment_research",
      response: {
        requestId: "request-1",
        sessionId: "session-1",
        message: "analysis",
        blocks: [],
        actions: [],
      },
      timestamp: "2026-03-08T00:00:02.000Z",
    });

    const session = await service.getSession("session-1");
    expect(session?.transcript).toHaveLength(2);
    expect(session?.lastIntent).toBe("investment_research");
    expect(session?.lastResult?.message).toBe("analysis");
    expect(session?.sessionSummary).toBeNull();
  });

  it("resets transcript state while keeping the session identity", async () => {
    const filePath = path.join(os.tmpdir(), `stock-claw-session-reset-${Date.now()}.json`);
    const service = new SessionService(new AppSessionStore(filePath));

    await service.createSession({
      sessionId: "session-reset",
      userId: "user-1",
      channel: "web",
      now: "2026-03-08T00:00:00.000Z",
    });
    await service.appendUserMessage({
      requestId: "request-1",
      channel: "web",
      userId: "user-1",
      sessionId: "session-reset",
      message: "Analyze AAPL",
      timestamp: "2026-03-08T00:00:01.000Z",
      metadata: {},
    });

    await service.resetSession("session-reset", "2026-03-08T00:00:02.000Z");
    const session = await service.getSession("session-reset");
    expect(session?.sessionId).toBe("session-reset");
    expect(session?.transcript).toHaveLength(0);
    expect(session?.lastIntent).toBeNull();
    expect(session?.lastResult).toBeNull();
    expect(session?.sessionSummary).toBeNull();
  });

  it("stores a session summary separately from the transcript", async () => {
    const filePath = path.join(os.tmpdir(), `stock-claw-session-summary-${Date.now()}.json`);
    const service = new SessionService(new AppSessionStore(filePath));

    await service.createSession({
      sessionId: "session-summary",
      userId: "user-1",
      channel: "web",
      now: "2026-03-08T00:00:00.000Z",
    });

    await service.updateSessionSummary({
      sessionId: "session-summary",
      summary: "# Live Session Summary\n- Session ID: session-summary",
      timestamp: "2026-03-08T00:00:03.000Z",
    });

    const session = await service.getSession("session-summary");
    expect(session?.sessionSummary).toContain("Live Session Summary");
    expect(session?.sessionSummaryUpdatedAt).toBe("2026-03-08T00:00:03.000Z");
  });
});
