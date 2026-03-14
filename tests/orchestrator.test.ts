import { describe, expect, it, vi } from "vitest";

import { Orchestrator } from "../src/orchestrator.js";

describe("Orchestrator intent classification", () => {
  const orchestrator = new Orchestrator(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  it("prefers research over risk keywords when analysis is requested", () => {
    expect(
      orchestrator.classifyIntent("Analyze AAPL from value, technical, and risk perspectives."),
    ).toBe("investment_research");
  });

  it("detects chinese analysis requests", () => {
    expect(orchestrator.classifyIntent("分析 AAPL 并给我一个结论")).toBe("investment_research");
  });

  it("detects trade requests", () => {
    expect(orchestrator.classifyIntent("buy 2 shares of AAPL")).toBe("trade_request");
  });

  it("detects ops requests", () => {
    expect(orchestrator.classifyIntent("install mcp for longport")).toBe("ops_request");
  });

  it("detects chinese skill installation requests", () => {
    expect(orchestrator.classifyIntent("Agent Browser clawhub的这个skill安装一下")).toBe("ops_request");
  });

  it("does not misclassify research just because MCP is mentioned", () => {
    expect(
      orchestrator.classifyIntent("Analyze AAPL and use the configured MCP tools if needed."),
    ).toBe("investment_research");
  });

  it("detects portfolio management updates from user holdings language", () => {
    expect(orchestrator.classifyIntent("I hold 10 shares of NVDA and my cash is 5000")).toBe(
      "portfolio_review",
    );
  });

  it("returns a reset response without duplicate blocks", async () => {
    const instance = new Orchestrator(
      {} as never,
      {
        writeDocument: async () => {},
      } as never,
      {} as never,
      {
        resetSession: async () => {},
      } as never,
      {} as never,
      {
        ensureRequestSession: async () => ({
          sessionId: "session-1",
          userId: "web-user",
          channel: "web",
          createdAt: "2026-03-13T10:00:00.000Z",
          updatedAt: "2026-03-13T10:04:17.000Z",
          lastIntent: "chat",
          transcript: [
            {
              role: "user",
              content: "hello",
              timestamp: "2026-03-13T10:00:00.000Z",
            },
          ],
          lastResult: null,
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
        }),
        appendAssistantResult: async () => ({}),
        resetSession: async () => ({
          sessionId: "session-1",
          userId: "web-user",
          channel: "web",
          createdAt: "2026-03-13T10:00:00.000Z",
          updatedAt: "2026-03-13T10:04:17.000Z",
          lastIntent: "chat",
          transcript: [],
          lastResult: null,
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
        }),
        updateSessionSummary: async () => {},
      } as never,
      {} as never,
    );

    const result = await instance.handle({
      requestId: "req-1",
      sessionId: "session-1",
      userId: "web-user",
      channel: "web",
      message: "/new",
      timestamp: "2026-03-13T10:04:17.000Z",
      metadata: {},
    });

    expect(result.response.message).toContain("active session has been reset");
    expect(result.response.blocks).toEqual([]);
  });

  it("manually compacts an existing session and updates the stored summary", async () => {
    const updateSessionSummary = vi.fn(async () => {});
    const compactSession = vi.fn(async () => ({
      compacted: true,
      summaryMarkdown: "# Live Session Summary\n\n- Session ID: telegram:200",
    }));
    const instance = new Orchestrator(
      {} as never,
      {} as never,
      {} as never,
      {
        compactSession,
      } as never,
      {} as never,
      {
        getSession: async () => ({
          sessionId: "telegram:200",
          userId: "telegram:200",
          channel: "telegram",
          createdAt: "2026-03-14T01:00:00.000Z",
          updatedAt: "2026-03-14T01:10:00.000Z",
          lastIntent: "chat",
          transcript: [
            {
              role: "user",
              content: "hello",
              timestamp: "2026-03-14T01:00:00.000Z",
            },
          ],
          lastResult: null,
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
        }),
        updateSessionSummary,
      } as never,
      {} as never,
    );

    const result = await instance.compactSession("telegram:200");

    expect(result.ok).toBe(true);
    expect(compactSession).toHaveBeenCalledWith("telegram:200", "chat");
    expect(updateSessionSummary).toHaveBeenCalledTimes(1);
  });
});
