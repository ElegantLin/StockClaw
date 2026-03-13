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
});
