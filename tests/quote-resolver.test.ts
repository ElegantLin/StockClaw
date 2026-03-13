import { describe, expect, it } from "vitest";

import { QuoteResolverService } from "../src/market/quote-resolver.js";

function assistantRun(sessionKey: string, message: string) {
  return {
    sessionFile: null,
    sessionId: sessionKey,
    message,
    compacted: false,
    toolCalls: [],
    usage: {
      input: 10,
      output: 10,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 20,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      turns: 1,
      contextTokens: 20,
    },
  };
}

describe("QuoteResolverService", () => {
  it("returns a structured quote committed by the resolver agent", async () => {
    const service = new QuoteResolverService(
      {
        runEphemeral: async (params: { sessionKey: string; customTools: Array<{ name: string; execute: Function }> }) => {
          const commit = params.customTools.find((tool) => tool.name === "market_commit_quote");
          await commit?.execute("tool-quote", {
            symbol: "AAPL.US",
            price: 201.45,
            field: "last",
            timestamp: "2026-03-11T10:00:00Z",
            currency: "USD",
            providerType: "mcp",
            providerName: "quotes-mcp",
            toolName: "get_quotes",
            rawEvidence: "last_done=201.45 timestamp=2026-03-11T10:00:00Z",
            warnings: [],
          });
          return assistantRun(params.sessionKey, "resolved quote");
        },
      } as never,
      {
        composeAgentPrompt: async () => "agent prompt",
        composeWorkflowPrompt: async () => "workflow prompt",
      } as never,
      () => [{ server: "quotes-mcp", name: "get_quotes", description: "quote" }],
    );

    const quote = await service.resolveQuote({
      sessionId: "web:test",
      rootUserMessage: "Buy AAPL now.",
      symbol: "aapl",
      purpose: "Resolve a live quote for paper-trade execution.",
    });

    expect(quote).toMatchObject({
      symbol: "AAPL.US",
      price: 201.45,
      field: "last",
      currency: "USD",
      providerType: "mcp",
      providerName: "quotes-mcp",
      toolName: "get_quotes",
    });
    expect(quote.resolutionSessionId).toMatch(/^quote-resolve:web:test:/);
  });

  it("fails when the resolver agent never commits a quote", async () => {
    const service = new QuoteResolverService(
      {
        runEphemeral: async (params: { sessionKey: string }) => assistantRun(params.sessionKey, "no quote committed"),
      } as never,
      {
        composeAgentPrompt: async () => "agent prompt",
        composeWorkflowPrompt: async () => "workflow prompt",
      } as never,
      () => [],
    );

    await expect(
      service.resolveQuote({
        sessionId: "web:test",
        rootUserMessage: "Check AAPL.",
        symbol: "AAPL.US",
        purpose: "Resolve a live quote for testing.",
      }),
    ).rejects.toThrow("Quote resolution did not commit quote data.");
  });
});
