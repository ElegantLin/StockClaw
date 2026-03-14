import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { ResearchCoordinator } from "../src/agents/coordinator.js";
import { ensureBootstrapMemoryFiles } from "../src/memory/bootstrap-files.js";
import { MemoryService } from "../src/memory/service.js";
import type { UserRequest } from "../src/types.js";

describe("ResearchCoordinator bootstrap memory injection", () => {
  it("injects user-writable bootstrap memory files into the root system prompt", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "stock-claw-coordinator-bootstrap-"));
    const memory = new MemoryService(root);
    await ensureBootstrapMemoryFiles(memory);
    await memory.appendDocument("non-investment/USER.md", "Agent Update", ["Call the user Alex."]);
    await memory.appendDocument("non-investment/MEMORY.md", "Agent Update", ["The user prefers concise, no-fluff replies."]);
    await memory.appendDocument("non-investment/TOOLS.md", "Agent Update", ["PinchTab is available on this machine."]);

    let capturedSystemPrompt = "";
    let capturedUserPrompt = "";
    const coordinator = new ResearchCoordinator(
      {
        runPersistent: vi.fn(async (params: { systemPrompt: string; userPrompt: string }) => {
          capturedSystemPrompt = params.systemPrompt;
          capturedUserPrompt = params.userPrompt;
          return {
            sessionId: "session-1",
            message: "ok",
            compacted: false,
            toolCalls: [],
            usage: {
              turns: 1,
              input: 1,
              output: 1,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 2,
              contextTokens: 2,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
          };
        }),
      } as never,
      {
        composeAgentPrompt: vi.fn(async () => "base prompt"),
        composeWorkflowPrompt: vi.fn(async () => "General Chat"),
      } as never,
      memory,
      {
        load: vi.fn(async () => ({
          accountId: "paper",
          mode: "paper",
          cash: 1000,
          equity: 1000,
          buyingPower: 1000,
          positions: [],
          openOrders: [],
          updatedAt: new Date().toISOString(),
        })),
      } as never,
      {
        get: vi.fn(() => ({ id: "orchestrator" })),
      } as never,
      {
        createTools: vi.fn(() => []),
      } as never,
      {
        history: vi.fn(async () => []),
      } as never,
    );

    const request: UserRequest = {
      requestId: "req-1",
      channel: "web",
      userId: "user-1",
      sessionId: "session-1",
      message: "hello",
      timestamp: "2026-03-11T00:00:00.000Z",
      metadata: {},
    };

    await coordinator.runRootTurn(request);

    expect(capturedSystemPrompt).toContain("User-writable bootstrap memory files are loaded below.");
    expect(capturedSystemPrompt).toContain("memory/non-investment/USER.md");
    expect(capturedSystemPrompt).toContain("Call the user Alex.");
    expect(capturedSystemPrompt).toContain("memory/non-investment/MEMORY.md");
    expect(capturedSystemPrompt).toContain("The user prefers concise, no-fluff replies.");
    expect(capturedSystemPrompt).toContain("memory/non-investment/TOOLS.md");
    expect(capturedSystemPrompt).toContain("PinchTab is available on this machine.");
    expect(capturedUserPrompt).not.toContain("Call the user Alex.");
    expect(capturedUserPrompt).not.toContain("The user prefers concise, no-fluff replies.");
    expect(capturedUserPrompt).not.toContain("PinchTab is available on this machine.");
  });
});
