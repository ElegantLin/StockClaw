import { describe, expect, it, vi } from "vitest";

import { Orchestrator } from "../src/orchestrator.js";
import type { UserRequest } from "../src/types.js";

describe("Orchestrator chat handling", () => {
  it("routes generic chat through the orchestrator agent instead of returning the static banner", async () => {
    const coordinator = {
      runRootTurn: vi.fn().mockResolvedValue({
        role: "orchestrator",
        sessionId: "session-1",
        message: "Hello. How can I help with your investing workflow today?",
        toolCalls: [],
      }),
    };
    const sessions = {
      ensureRequestSession: vi.fn().mockResolvedValue(null),
      appendUserMessage: vi.fn().mockResolvedValue(undefined),
      appendAssistantResult: vi.fn().mockImplementation(async ({ response }: { response: unknown }) => ({
        sessionId: "session-1",
        transcript: [],
        updatedAt: "2026-03-08T00:00:00.000Z",
        lastIntent: "chat",
        response,
      })),
      updateSessionSummary: vi.fn().mockResolvedValue(undefined),
    };
    const memory = {
      appendDocument: vi.fn().mockResolvedValue(undefined),
      writeDocument: vi.fn().mockResolvedValue(undefined),
    };

    const orchestrator = new Orchestrator(
      {} as never,
      memory as never,
      {} as never,
      coordinator as never,
      {} as never,
      sessions as never,
      {} as never,
    );

    const request: UserRequest = {
      requestId: "req-1",
      sessionId: "session-1",
      userId: "user-1",
      channel: "telegram",
      message: "hi",
      timestamp: "2026-03-08T00:00:00.000Z",
      metadata: {},
    };

    const result = await orchestrator.handle(request);

    expect(coordinator.runRootTurn).toHaveBeenCalledWith(request);
    expect(result.intent).toBe("chat");
    expect(result.response.message).toContain("How can I help");
  });

  it("uses an LLM compaction summary for the session summary when the run compacted", async () => {
    const coordinator = {
      runRootTurn: vi.fn().mockResolvedValue({
        role: "orchestrator",
        sessionId: "session-1",
        message: "Compacted response.",
        toolCalls: [],
        compacted: true,
      }),
    };
    const sessions = {
      ensureRequestSession: vi.fn().mockResolvedValue(null),
      appendUserMessage: vi.fn().mockResolvedValue(undefined),
      appendAssistantResult: vi.fn().mockImplementation(async ({ response }: { response: unknown }) => ({
        sessionId: "session-1",
        userId: "user-1",
        channel: "telegram",
        createdAt: "2026-03-08T00:00:00.000Z",
        updatedAt: "2026-03-08T00:00:00.000Z",
        lastIntent: "chat",
        transcript: [
          {
            role: "user",
            content: "hi",
            timestamp: "2026-03-08T00:00:00.000Z",
          },
          {
            role: "assistant",
            content: "Compacted response.",
            timestamp: "2026-03-08T00:00:01.000Z",
          },
        ],
        lastResult: response,
        sessionSummary: null,
        sessionSummaryUpdatedAt: null,
        lastUsage: null,
        cumulativeUsage: {
          turns: 0,
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          contextTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        dailyUsage: {
          turns: 0,
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          contextTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        dailyUsageDate: null,
      })),
      updateSessionSummary: vi.fn().mockResolvedValue(undefined),
    };
    const memory = {
      appendDocument: vi.fn().mockResolvedValue(undefined),
      writeDocument: vi.fn().mockResolvedValue(undefined),
    };
    const prompts = {
      composeWorkflowPrompt: vi.fn().mockResolvedValue("Compaction workflow instructions"),
    };
    const piRuntime = {
      runEphemeral: vi.fn().mockResolvedValue({
        message: [
          "## Compressed Context",
          "",
          "- User asked for continuity after compaction.",
          "",
          "## Durable Preferences And Constraints",
          "",
          "- none",
          "",
          "## Open Loops And Pending Work",
          "",
          "- none",
          "",
          "## Recent Conclusions",
          "",
          "- Compacted response.",
        ].join("\n"),
      }),
    };

    const orchestrator = new Orchestrator(
      prompts as never,
      memory as never,
      {} as never,
      coordinator as never,
      {} as never,
      sessions as never,
      {} as never,
      null,
      piRuntime as never,
    );

    const request: UserRequest = {
      requestId: "req-1",
      sessionId: "session-1",
      userId: "user-1",
      channel: "telegram",
      message: "hi",
      timestamp: "2026-03-08T00:00:00.000Z",
      metadata: {},
    };

    await orchestrator.handle(request);

    expect(piRuntime.runEphemeral).toHaveBeenCalled();
    expect(memory.writeDocument).toHaveBeenCalledWith(
      "sessions/live/session-1.md",
      expect.stringContaining("## Compressed Context"),
    );
    expect(sessions.updateSessionSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        summary: expect.stringContaining("## Compressed Context"),
      }),
    );
  });
});
