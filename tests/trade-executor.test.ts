import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { AuditLogger } from "../src/audit/logger.js";
import { TradeExecutor } from "../src/execution/executor.js";
import { MemoryService } from "../src/memory/service.js";
import { PortfolioStore } from "../src/portfolio/store.js";

describe("TradeExecutor", () => {
  it("resolves a live quote through the quote resolver before filling a paper trade", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-trade-executor-"));
    const portfolio = new PortfolioStore(path.join(dir, "portfolio.json"));
    await portfolio.replace({
      accountId: "paper",
      mode: "paper",
      cash: 10_000,
      equity: 10_000,
      buyingPower: 10_000,
      positions: [],
      openOrders: [],
      updatedAt: new Date("2026-03-11T00:00:00Z").toISOString(),
    });
    const memory = new MemoryService(path.join(dir, "memory"));
    const audit = new AuditLogger(path.join(dir, "trade_log.jsonl"));
    const executor = new TradeExecutor(
      portfolio,
      {
        normalizeSymbol: (symbol: string) => (symbol.includes(".") ? symbol.toUpperCase() : `${symbol.toUpperCase()}.US`),
        resolveQuote: async (params: { symbol: string }) => ({
          symbol: params.symbol,
          price: 250,
          field: "last",
          timestamp: "2026-03-11T10:00:00Z",
          currency: "USD",
          providerType: "mcp",
          providerName: "quotes-mcp",
          toolName: "get_quotes",
          rawEvidence: "last_done=250",
          warnings: [],
          resolutionSessionId: "quote:1",
          resolutionMessage: "resolved",
          resolutionToolCalls: [],
        }),
      } as never,
      memory,
      audit,
    );

    const result = await executor.execute(
      {
        symbol: "aapl",
        side: "buy",
        quantity: 10,
        orderType: "market",
        limitPrice: null,
        rationale: "Open a starter position.",
      },
      {
        sessionId: "web:test",
        rootUserMessage: "Buy 10 shares of AAPL.",
      },
    );

    expect(result.status).toBe("filled");
    expect(result.symbol).toBe("AAPL.US");
    expect(result.price).toBe(250);
    expect(result.message).toContain("quotes-mcp/get_quotes");
  });
});
