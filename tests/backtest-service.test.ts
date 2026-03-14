import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import { BacktestNotifier } from "../src/backtest/notifier.js";
import { BacktestService } from "../src/backtest/service.js";
import { BacktestWorkerLock } from "../src/backtest/worker-lock.js";
import { MemoryService } from "../src/memory/service.js";
import { PortfolioStore } from "../src/portfolio/store.js";
import { PromptRegistry } from "../src/prompts/registry.js";
import { SessionService } from "../src/sessions/service.js";
import { AppSessionStore } from "../src/state/app-session-store.js";
import { BacktestJobStore } from "../src/state/backtest-job-store.js";
import { BacktestStore } from "../src/state/backtest-store.js";

function createPiRuntimeStub(options: {
  prepareWarnings?: string[] | ((symbols: string[]) => string[]);
  onPrepare?: (params: {
    sessionKey: string;
    userPrompt?: string;
    customTools: Array<{ name: string; execute: Function }>;
  }) => Promise<void> | void;
  onDay?: (params: { sessionKey: string; customTools: Array<{ name: string; execute: Function }> }) => Promise<void> | void;
  onContext?: (params: {
    sessionKey: string;
    userPrompt?: string;
    customTools: Array<{ name: string; execute: Function }>;
  }) => Promise<void> | void;
}) {
  return {
    runEphemeral: async (params: { sessionKey: string; userPrompt?: string; customTools: Array<{ name: string; execute: Function }> }) => {
      if (params.sessionKey.startsWith("backtest-prepare:")) {
        if (options.onPrepare) {
          await options.onPrepare(params);
          return assistantRun(params.sessionKey, "prepared dataset");
        }
        const commit = params.customTools.find((tool) => tool.name === "backtest_commit_prepared_data");
        const symbols = parseRequestedSymbols(params.userPrompt ?? "");
        const { dateFrom, dateTo } = parseDateWindow(params.userPrompt ?? "");
        await commit?.execute("tool-prepare", {
          provider: {
            server: "stub",
            historyTool: "get_historical_k_data",
            tradeDatesTool: "get_trade_dates",
          },
          calendar: buildCalendar(dateFrom, dateTo),
          warnings:
            typeof options.prepareWarnings === "function"
              ? options.prepareWarnings(symbols)
              : (options.prepareWarnings ?? []),
          barsBySymbol: Object.fromEntries(
            symbols.map((symbol) => [
              symbol,
              buildBarsForSymbol(symbol, dateFrom, dateTo),
            ]),
          ),
        });
        return assistantRun(params.sessionKey, "prepared dataset");
      }
      if (params.sessionKey.includes(":context:")) {
        if (options.onContext) {
          await options.onContext(params);
        } else {
          const currentDate = parseCurrentTradingDate(params.userPrompt ?? "");
          const commit = params.customTools.find((tool) => tool.name === "backtest_commit_context");
          const symbols = parseRequestedSymbols(params.userPrompt ?? "");
          await commit?.execute("tool-context", {
            asOf: priorDate(currentDate),
            providerType: "mcp",
            providerName: "stub",
            toolName: "resolve_context",
            title: "Historical context",
            summary: "Resolved extra historical context from stub data.",
            findings: ["Stub context resolved."],
            rawEvidence: ["stub evidence"],
            payloadJson: JSON.stringify({ ok: true }),
            warnings: [],
            symbols,
          });
        }
        return assistantRun(params.sessionKey, "resolved context");
      }
      await options.onDay?.(params);
      return assistantRun(params.sessionKey, "decision complete");
    },
  } as never;
}

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

function parseRequestedSymbols(prompt: string): string[] {
  const match = prompt.match(/Requested symbols:\s*(.+)/);
  return match?.[1]?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
}

function parseDateWindow(prompt: string): { dateFrom: string; dateTo: string } {
  const match = prompt.match(/Date window:\s*(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})/);
  if (!match) {
    throw new Error(`Unable to parse backtest date window from prompt: ${prompt}`);
  }
  return {
    dateFrom: match[1],
    dateTo: match[2],
  };
}

function parseCurrentTradingDate(prompt: string): string {
  const match = prompt.match(/Current trading date:\s*(\d{4}-\d{2}-\d{2})/);
  if (!match) {
    throw new Error(`Unable to parse current trading date from prompt: ${prompt}`);
  }
  return match[1];
}

function priorDate(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString();
}

function buildCalendar(dateFrom: string, dateTo: string): string[] {
  return dateFrom === dateTo ? [dateFrom] : [dateFrom, dateTo];
}

function buildBarsForSymbol(symbol: string, dateFrom: string, dateTo: string) {
  const basePrice = symbol.startsWith("AAPL") ? 100 : 200;
  if (dateFrom === dateTo) {
    return [
      {
        date: dateFrom,
        open: basePrice,
        high: basePrice,
        low: basePrice,
        close: basePrice,
        volume: 1000,
        turnover: basePrice * 1000,
        rawTime: null,
      },
    ];
  }
  return [
    {
      date: dateFrom,
      open: basePrice,
      high: basePrice + 1,
      low: basePrice - 1,
      close: basePrice,
      volume: 1000,
      turnover: basePrice * 1000,
      rawTime: null,
    },
    {
      date: dateTo,
      open: basePrice + 1,
      high: basePrice + 6,
      low: basePrice,
      close: basePrice + 5,
      volume: 1100,
      turnover: (basePrice + 5) * 1100,
      rawTime: null,
    },
  ];
}

describe("BacktestService", () => {
  it("prepares a dataset, then runs daily decision sessions from the frozen run id", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-backtest-service-"));
    const sessions = new SessionService(new AppSessionStore(path.join(dir, "app-sessions.json")));
    await sessions.createSession({ sessionId: "web:test", userId: "user", channel: "web" });
    const service = new BacktestService(
      new BacktestStore(path.join(dir, "backtests.json"), path.join(dir, "runs")),
      new BacktestJobStore(path.join(dir, "backtest-jobs.json"), path.join(dir, "jobs")),
      new BacktestNotifier(
        sessions,
        new MemoryService(path.join(dir, "memory")),
        {
          sendSystemNotice: async () => undefined,
        } as never,
      ),
      {
        listTools: () => [
          { server: "stub", name: "get_historical_k_data", description: "history" },
          { server: "stub", name: "get_trade_dates", description: "calendar" },
        ],
        callTool: async (_server: string, toolName: string) => {
          if (toolName === "get_trade_dates") {
            return {
              server: "stub",
              name: toolName,
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    data: [
                      { calendar_date: "2026-01-02" },
                      { calendar_date: "2026-01-05" },
                    ],
                  }),
                },
              ],
            };
          }
          return {
            server: "stub",
            name: toolName,
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  data: [
                    { open: 100, high: 101, low: 99, close: 100, volume: 1000, turnover: 100000 },
                    { open: 101, high: 106, low: 100, close: 105, volume: 1100, turnover: 115500 },
                  ],
                }),
              },
            ],
          };
        },
      } as never,
      createPiRuntimeStub({
        onDay: async (params) => {
          if (params.sessionKey.endsWith("2026-01-02")) {
            const buy = params.customTools.find((tool) => tool.name === "paper_trade_buy");
            await buy?.execute("tool-1", {
              symbol: "AAPL.US",
              quantity: 1,
              rationale: "enter position",
            });
          }
        },
      }),
      new PromptRegistry("prompts"),
      new PortfolioStore(path.join(dir, "portfolio.json")),
      sessions,
      {
        workerLock: new BacktestWorkerLock(path.join(dir, "backtest-worker.lock.json")),
      },
    );

    const prepared = await service.prepareAsset(
      {
        symbol: "AAPL",
        dateFrom: "2026-01-02",
        dateTo: "2026-01-05",
        initialCash: 1000,
        feesBps: 0,
        slippageBps: 0,
        spawnSpecialists: false,
      },
      {
        sessionId: "web:test",
        rootUserMessage: "请回测 AAPL 并只返回最终结果。",
      },
    );
    const result = await service.runDataset(prepared.runId);

    expect(result.status).toBe("completed");
    expect(result.report.filledOrders).toBe(1);
    expect(result.report.rejectedOrders).toBe(0);
    expect(result.report.startEquity).toBe(1000);
    expect(result.report.endEquity).toBe(1005);
    expect(result.report.totalReturnPct).toBe(0.5);
    expect(result.report.filledTrades).toHaveLength(1);
    expect(result.report.rejectedTrades).toHaveLength(0);
    expect(result.report.endingPortfolio.positions[0]?.symbol).toBe("AAPL.US");
    expect(result.report.summary).toContain("Backtest");
  }, 15000);

  it("accepts partial prepared-data commits and freezes the dataset after all symbols are collected", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-backtest-prepare-partial-"));
    const sessions = new SessionService(new AppSessionStore(path.join(dir, "app-sessions.json")));
    await sessions.createSession({ sessionId: "web:test", userId: "user", channel: "web" });
    const service = new BacktestService(
      new BacktestStore(path.join(dir, "backtests.json"), path.join(dir, "runs")),
      new BacktestJobStore(path.join(dir, "backtest-jobs.json"), path.join(dir, "jobs")),
      new BacktestNotifier(
        sessions,
        new MemoryService(path.join(dir, "memory")),
        {
          sendSystemNotice: async () => undefined,
        } as never,
      ),
      {
        listTools: () => [
          { server: "stub", name: "get_historical_k_data", description: "history" },
          { server: "stub", name: "get_trade_dates", description: "calendar" },
        ],
      } as never,
      createPiRuntimeStub({
        onPrepare: async (params) => {
          const commit = params.customTools.find((tool) => tool.name === "backtest_commit_prepared_data");
          const { dateFrom, dateTo } = parseDateWindow(params.userPrompt ?? "");
          await commit?.execute("tool-prepare-1", {
            provider: {
              server: "stub",
              historyTool: "get_historical_k_data",
              tradeDatesTool: "get_trade_dates",
            },
            calendar: buildCalendar(dateFrom, dateTo),
            warnings: [],
            barsBySymbol: {
              "AAPL.US": buildBarsForSymbol("AAPL.US", dateFrom, dateTo),
            },
          });
          await commit?.execute("tool-prepare-2", {
            provider: {
              server: "stub",
              historyTool: "get_historical_k_data",
              tradeDatesTool: "get_trade_dates",
            },
            calendar: buildCalendar(dateFrom, dateTo),
            warnings: [],
            barsBySymbol: {
              "MSFT.US": buildBarsForSymbol("MSFT.US", dateFrom, dateTo),
            },
          });
        },
      }),
      new PromptRegistry("prompts"),
      new PortfolioStore(path.join(dir, "portfolio.json")),
      sessions,
      {
        workerLock: new BacktestWorkerLock(path.join(dir, "backtest-worker.lock.json")),
      },
    );

    const prepared = await service.preparePortfolio(
      {
        dateFrom: "2026-01-02",
        dateTo: "2026-01-05",
        cash: 1000,
        positions: [
          { symbol: "AAPL.US", quantity: 1, avgCost: 100 },
          { symbol: "MSFT.US", quantity: 1, avgCost: 200 },
        ],
        spawnSpecialists: false,
      },
      {
        sessionId: "web:test",
        rootUserMessage: "分批准备组合回测数据",
      },
    );
    const result = await service.runDataset(prepared.runId);

    expect(prepared.symbols).toEqual(["AAPL.US", "MSFT.US"]);
    expect(prepared.tradingDays).toBe(2);
    expect(result.status).toBe("completed");
    expect(result.report.symbols).toEqual(["AAPL.US", "MSFT.US"]);
  });

  it("marks custom portfolio holdings to the first trading day open when avgCost is omitted", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-backtest-portfolio-"));
    const sessions = new SessionService(new AppSessionStore(path.join(dir, "app-sessions.json")));
    await sessions.createSession({ sessionId: "web:test", userId: "user", channel: "web" });
    const service = new BacktestService(
      new BacktestStore(path.join(dir, "backtests.json"), path.join(dir, "runs")),
      new BacktestJobStore(path.join(dir, "backtest-jobs.json"), path.join(dir, "jobs")),
      new BacktestNotifier(
        sessions,
        new MemoryService(path.join(dir, "memory")),
        {
          sendSystemNotice: async () => undefined,
        } as never,
      ),
      {
        listTools: () => [
          { server: "stub", name: "get_historical_k_data", description: "history" },
          { server: "stub", name: "get_trade_dates", description: "calendar" },
        ],
        callTool: async (_server: string, toolName: string, args: Record<string, unknown>) => {
          if (toolName === "get_trade_dates") {
            return {
              server: "stub",
              name: toolName,
              content: [{ type: "text", text: JSON.stringify({ data: [{ calendar_date: "2026-01-02" }] }) }],
            };
          }
          const code = String(args.code);
          const price = code.startsWith("AAPL") ? 100 : 200;
          return {
            server: "stub",
            name: toolName,
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  data: [{ open: price, high: price, low: price, close: price, volume: 1000, turnover: price * 1000 }],
                }),
              },
            ],
          };
        },
      } as never,
      createPiRuntimeStub({
        prepareWarnings: (symbols) =>
          symbols.map(
            (symbol) =>
              `Historical bars for ${symbol} did not include explicit dates; dates were aligned from provider trade_dates output.`,
          ),
      }),
      new PromptRegistry("prompts"),
      new PortfolioStore(path.join(dir, "portfolio.json")),
      sessions,
      {
        workerLock: new BacktestWorkerLock(path.join(dir, "backtest-worker.lock.json")),
      },
    );

    const prepared = await service.preparePortfolio(
      {
        dateFrom: "2026-01-02",
        dateTo: "2026-01-02",
        cash: 15000,
        positions: [
          { symbol: "AAPL.US", quantity: 10 },
          { symbol: "MSFT.US", quantity: 5 },
        ],
        spawnSpecialists: false,
      },
      {
        sessionId: "web:test",
        rootUserMessage: "portfolio smoke",
      },
    );
    const result = await service.runDataset(prepared.runId);

    expect(result.report.startEquity).toBe(17000);
    expect(result.report.endEquity).toBe(17000);
    expect(result.report.totalReturnPct).toBe(0);
  });

  it("retries transient network errors during day execution and still completes the run", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-backtest-retry-"));
    const sessions = new SessionService(new AppSessionStore(path.join(dir, "app-sessions.json")));
    await sessions.createSession({ sessionId: "web:test", userId: "user", channel: "web" });
    const attempts = new Map<string, number>();
    const piRuntime = {
      runEphemeral: async (params: { sessionKey: string; userPrompt?: string; customTools: Array<{ name: string; execute: Function }> }) => {
        if (params.sessionKey.startsWith("backtest-prepare:")) {
          const commit = params.customTools.find((tool) => tool.name === "backtest_commit_prepared_data");
          const symbols = parseRequestedSymbols(params.userPrompt ?? "");
          const { dateFrom, dateTo } = parseDateWindow(params.userPrompt ?? "");
          await commit?.execute("tool-prepare", {
            provider: {
              server: "stub",
              historyTool: "get_historical_k_data",
              tradeDatesTool: "get_trade_dates",
            },
            calendar: buildCalendar(dateFrom, dateTo),
            warnings: [],
            barsBySymbol: Object.fromEntries(
              symbols.map((symbol) => [
                symbol,
                buildBarsForSymbol(symbol, dateFrom, dateTo),
              ]),
            ),
          });
          return assistantRun(params.sessionKey, "prepared dataset");
        }
        const attempt = (attempts.get(params.sessionKey) ?? 0) + 1;
        attempts.set(params.sessionKey, attempt);
        if (params.sessionKey.endsWith("2026-01-02") && attempt === 1) {
          throw new Error("Unhandled stop reason: network_error");
        }
        return assistantRun(params.sessionKey, "decision complete");
      },
    } as never;
    const service = new BacktestService(
      new BacktestStore(path.join(dir, "backtests.json"), path.join(dir, "runs")),
      new BacktestJobStore(path.join(dir, "backtest-jobs.json"), path.join(dir, "jobs")),
      new BacktestNotifier(
        sessions,
        new MemoryService(path.join(dir, "memory")),
        {
          sendSystemNotice: async () => undefined,
        } as never,
      ),
      {
        listTools: () => [
          { server: "stub", name: "get_historical_k_data", description: "history" },
          { server: "stub", name: "get_trade_dates", description: "calendar" },
        ],
      } as never,
      piRuntime,
      new PromptRegistry("prompts"),
      new PortfolioStore(path.join(dir, "portfolio.json")),
      sessions,
      {
        workerLock: new BacktestWorkerLock(path.join(dir, "backtest-worker.lock.json")),
      },
    );

    const prepared = await service.prepareAsset(
      {
        symbol: "AAPL",
        dateFrom: "2026-01-02",
        dateTo: "2026-01-05",
        initialCash: 1000,
        spawnSpecialists: false,
      },
      {
        sessionId: "web:test",
        rootUserMessage: "retry transient network error",
      },
    );
    const result = await service.runDataset(prepared.runId);

    expect(result.status).toBe("completed");
    expect(result.error).toBeNull();
    expect([...attempts.entries()].find(([sessionKey]) => sessionKey.endsWith("2026-01-02"))?.[1]).toBe(2);
    expect([...attempts.entries()].find(([sessionKey]) => sessionKey.endsWith("2026-01-05"))?.[1]).toBe(1);
  });

  it("aggregates missing-date warnings instead of repeating them per symbol", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-backtest-warnings-"));
    const sessions = new SessionService(new AppSessionStore(path.join(dir, "app-sessions.json")));
    await sessions.createSession({ sessionId: "web:test", userId: "user", channel: "web" });
    const service = new BacktestService(
      new BacktestStore(path.join(dir, "backtests.json"), path.join(dir, "runs")),
      new BacktestJobStore(path.join(dir, "backtest-jobs.json"), path.join(dir, "jobs")),
      new BacktestNotifier(
        sessions,
        new MemoryService(path.join(dir, "memory")),
        {
          sendSystemNotice: async () => undefined,
        } as never,
      ),
      {
        listTools: () => [
          { server: "stub", name: "get_historical_k_data", description: "history" },
          { server: "stub", name: "get_trade_dates", description: "calendar" },
        ],
        callTool: async (_server: string, toolName: string) => {
          if (toolName === "get_trade_dates") {
            return {
              server: "stub",
              name: toolName,
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    data: [
                      { calendar_date: "2026-01-02" },
                      { calendar_date: "2026-01-05" },
                    ],
                  }),
                },
              ],
            };
          }
          return {
            server: "stub",
            name: toolName,
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  data: [
                    { open: 100, high: 101, low: 99, close: 100, volume: 1000, turnover: 100000 },
                    { open: 101, high: 106, low: 100, close: 105, volume: 1100, turnover: 115500 },
                  ],
                }),
              },
            ],
          };
        },
      } as never,
      createPiRuntimeStub({
        prepareWarnings: (symbols) =>
          symbols.map(
            (symbol) =>
              `Historical bars for ${symbol} did not include explicit dates; dates were aligned from provider trade_dates output.`,
          ),
      }),
      new PromptRegistry("prompts"),
      new PortfolioStore(path.join(dir, "portfolio.json")),
      sessions,
      {
        workerLock: new BacktestWorkerLock(path.join(dir, "backtest-worker.lock.json")),
      },
    );

    const prepared = await service.preparePortfolio(
      {
        dateFrom: "2026-01-02",
        dateTo: "2026-01-05",
        cash: 1000,
        positions: [
          { symbol: "AAPL.US", quantity: 1, avgCost: 100 },
          { symbol: "MSFT.US", quantity: 1, avgCost: 100 },
        ],
        spawnSpecialists: false,
      },
      {
        sessionId: "web:test",
        rootUserMessage: "aggregate warnings",
      },
    );

    expect(prepared.warnings).toHaveLength(1);
    expect(prepared.warnings[0]).toContain("2 symbol(s)");
    expect(prepared.warnings[0]).toContain("AAPL.US, MSFT.US");
    expect(prepared.warnings[0]).toContain("stub/get_historical_k_data");
  });

  it("merges partial prepare commits across multiple tool calls before freezing the dataset", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-backtest-partial-prepare-"));
    const sessions = new SessionService(new AppSessionStore(path.join(dir, "app-sessions.json")));
    await sessions.createSession({ sessionId: "web:test", userId: "user", channel: "web" });
    const piRuntime = {
      runEphemeral: async (params: { sessionKey: string; userPrompt?: string; customTools: Array<{ name: string; execute: Function }> }) => {
        if (params.sessionKey.startsWith("backtest-prepare:")) {
          const commit = params.customTools.find((tool) => tool.name === "backtest_commit_prepared_data");
          const symbols = parseRequestedSymbols(params.userPrompt ?? "");
          const { dateFrom, dateTo } = parseDateWindow(params.userPrompt ?? "");
          await commit?.execute("tool-prepare-1", {
            provider: {
              server: "stub",
              historyTool: "get_historical_k_data",
              tradeDatesTool: "get_trade_dates",
            },
            calendar: buildCalendar(dateFrom, dateTo),
            barsBySymbol: {
              [symbols[0]!]: buildBarsForSymbol(symbols[0]!, dateFrom, dateTo),
            },
          });
          await commit?.execute("tool-prepare-2", {
            barsBySymbol: {
              [symbols[1]!]: buildBarsForSymbol(symbols[1]!, dateFrom, dateTo),
            },
          });
          return assistantRun(params.sessionKey, "prepared dataset");
        }
        return assistantRun(params.sessionKey, "decision complete");
      },
    } as never;
    const service = new BacktestService(
      new BacktestStore(path.join(dir, "backtests.json"), path.join(dir, "runs")),
      new BacktestJobStore(path.join(dir, "backtest-jobs.json"), path.join(dir, "jobs")),
      new BacktestNotifier(
        sessions,
        new MemoryService(path.join(dir, "memory")),
        {
          sendSystemNotice: async () => undefined,
        } as never,
      ),
      {
        listTools: () => [
          { server: "stub", name: "get_historical_k_data", description: "history" },
          { server: "stub", name: "get_trade_dates", description: "calendar" },
        ],
      } as never,
      piRuntime,
      new PromptRegistry("prompts"),
      new PortfolioStore(path.join(dir, "portfolio.json")),
      sessions,
      {
        workerLock: new BacktestWorkerLock(path.join(dir, "backtest-worker.lock.json")),
      },
    );

    const prepared = await service.preparePortfolio(
      {
        dateFrom: "2026-01-02",
        dateTo: "2026-01-05",
        cash: 1000,
        positions: [
          { symbol: "AAPL.US", quantity: 1, avgCost: 100 },
          { symbol: "MSFT.US", quantity: 1, avgCost: 200 },
        ],
        spawnSpecialists: false,
      },
      {
        sessionId: "web:test",
        rootUserMessage: "partial commit should still work",
      },
    );

    expect(prepared.symbols).toEqual(["AAPL.US", "MSFT.US"]);
    expect(prepared.tradingDays).toBe(2);
    expect(prepared.provider.server).toBe("stub");
  });

  it("queues wrapper jobs, runs them in the background, and appends only the final result to the parent session", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-backtest-async-"));
    const sessions = new SessionService(new AppSessionStore(path.join(dir, "app-sessions.json")));
    await sessions.createSession({ sessionId: "telegram:200", userId: "telegram:200", channel: "telegram" });
    const sendSystemNotice = vi.fn(async () => undefined);
    const service = new BacktestService(
      new BacktestStore(path.join(dir, "backtests.json"), path.join(dir, "runs")),
      new BacktestJobStore(path.join(dir, "backtest-jobs.json"), path.join(dir, "jobs")),
      new BacktestNotifier(
        sessions,
        new MemoryService(path.join(dir, "memory")),
        {
          sendSystemNotice,
        } as never,
      ),
      {
        listTools: () => [
          { server: "stub", name: "get_historical_k_data", description: "history" },
          { server: "stub", name: "get_trade_dates", description: "calendar" },
        ],
        callTool: async (_server: string, toolName: string) => {
          if (toolName === "get_trade_dates") {
            return {
              server: "stub",
              name: toolName,
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    data: [
                      { calendar_date: "2026-01-02" },
                      { calendar_date: "2026-01-05" },
                    ],
                  }),
                },
              ],
            };
          }
          return {
            server: "stub",
            name: toolName,
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  data: [
                    { open: 100, high: 101, low: 99, close: 100, volume: 1000, turnover: 100000 },
                    { open: 101, high: 106, low: 100, close: 105, volume: 1100, turnover: 115500 },
                  ],
                }),
              },
            ],
          };
        },
      } as never,
      createPiRuntimeStub({
        onDay: async (params) => {
          if (params.sessionKey.endsWith("2026-01-02")) {
            const buy = params.customTools.find((tool) => tool.name === "paper_trade_buy");
            await buy?.execute("tool-1", {
              symbol: "AAPL.US",
              quantity: 1,
              rationale: "enter position",
            });
          }
        },
      }),
      new PromptRegistry("prompts"),
      new PortfolioStore(path.join(dir, "portfolio.json")),
      sessions,
      {
        workerLock: new BacktestWorkerLock(path.join(dir, "backtest-worker.lock.json")),
      },
    );
    await service.start();

    const queued = await service.submitAssetJob(
      {
        symbol: "AAPL",
        dateFrom: "2026-01-02",
        dateTo: "2026-01-05",
        initialCash: 1000,
        spawnSpecialists: false,
      },
      {
        sessionId: "telegram:200",
        requestId: "req-1",
        rootUserMessage: "回测 AAPL",
      },
    );

    expect(queued.status).toBe("queued");

    for (let attempt = 0; attempt < 100; attempt += 1) {
      const snapshot = await service.getSessionJobsSnapshot("telegram:200");
      if (snapshot.counts.completed === 1 && snapshot.jobs[0]?.deliveredAt) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    const snapshot = await service.getSessionJobsSnapshot("telegram:200");
    expect(snapshot.counts.completed).toBe(1);
    expect(snapshot.jobs[0]?.deliveredAt).toBeTruthy();
    expect(snapshot.jobs[0]?.tracePath).toBeTruthy();
    expect(snapshot.jobs[0]?.reportPath).toBeTruthy();
    expect(sendSystemNotice).toHaveBeenCalledTimes(1);

    const session = await sessions.getSession("telegram:200");
    expect(session?.transcript.at(-1)?.content).toContain("Backtest job completed");
    expect(session?.transcript.at(-1)?.content).toContain("Filled Trades:");
    expect(session?.transcript.at(-1)?.content).toContain("AAPL.US");

    const trace = await readFile(snapshot.jobs[0]!.tracePath!, "utf8");
    const report = await readFile(snapshot.jobs[0]!.reportPath!, "utf8");
    expect(trace).toContain("\"type\":\"job_submitted\"");
    expect(trace).toContain("\"type\":\"trade_filled\"");
    expect(trace).toContain("\"type\":\"delivery_succeeded\"");
    expect(report).toContain("## Filled Trades");
    expect(report).toContain("AAPL.US");
    expect(report).toContain("## Daily Decisions");

    await service.close();
  });

  it("resolves and caches same-day historical context snapshots through the day-level root tool", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-backtest-context-"));
    const sessions = new SessionService(new AppSessionStore(path.join(dir, "app-sessions.json")));
    await sessions.createSession({ sessionId: "web:test", userId: "user", channel: "web" });
    const store = new BacktestStore(path.join(dir, "backtests.json"), path.join(dir, "runs"));
    let contextRuns = 0;
    const service = new BacktestService(
      store,
      new BacktestJobStore(path.join(dir, "backtest-jobs.json"), path.join(dir, "jobs")),
      new BacktestNotifier(
        sessions,
        new MemoryService(path.join(dir, "memory")),
        {
          sendSystemNotice: async () => undefined,
        } as never,
      ),
      {
        listTools: () => [
          { server: "stub", name: "get_historical_k_data", description: "history" },
          { server: "stub", name: "get_trade_dates", description: "calendar" },
        ],
      } as never,
      createPiRuntimeStub({
        onDay: async (params) => {
          if (params.sessionKey.endsWith("2026-01-02")) {
            const context = params.customTools.find((tool) => tool.name === "backtest_request_context");
            await context?.execute("tool-context-1", {
              contextType: "news",
              objective: "Summarize relevant company headlines before deciding.",
              symbols: ["AAPL.US"],
              lookbackDays: 5,
              maxItems: 3,
            });
            await context?.execute("tool-context-2", {
              contextType: "news",
              objective: "Summarize relevant company headlines before deciding.",
              symbols: ["AAPL.US"],
              lookbackDays: 5,
              maxItems: 3,
            });
          }
        },
        onContext: async (params) => {
          contextRuns += 1;
          const currentDate = parseCurrentTradingDate(params.userPrompt ?? "");
          const commit = params.customTools.find((tool) => tool.name === "backtest_commit_context");
          await commit?.execute("tool-context", {
            asOf: priorDate(currentDate),
            providerType: "skill",
            providerName: "stub-skill",
            toolName: "stub_context_script",
            title: "Headline snapshot",
            summary: "A cached historical context snapshot for AAPL.",
            findings: ["Headline one", "Headline two"],
            rawEvidence: ["evidence 1"],
            payloadJson: JSON.stringify({ headlines: 2 }),
            warnings: [],
            symbols: ["AAPL.US"],
          });
        },
      }),
      new PromptRegistry("prompts"),
      new PortfolioStore(path.join(dir, "portfolio.json")),
      sessions,
      {
        workerLock: new BacktestWorkerLock(path.join(dir, "backtest-worker.lock.json")),
      },
    );

    const prepared = await service.prepareAsset(
      {
        symbol: "AAPL",
        dateFrom: "2026-01-02",
        dateTo: "2026-01-05",
        initialCash: 1000,
        spawnSpecialists: false,
      },
      {
        sessionId: "web:test",
        rootUserMessage: "请回测 AAPL，并在需要时读取额外历史上下文。",
      },
    );
    const result = await service.runDataset(prepared.runId);
    const run = await store.getRun(prepared.runId);

    expect(result.status).toBe("completed");
    expect(contextRuns).toBe(1);
    expect(run?.contextSnapshots).toHaveLength(1);
    expect(run?.contextSnapshots[0]?.request.contextType).toBe("news");
    expect(run?.contextSnapshots[0]?.providerName).toBe("stub-skill");
    expect(run?.contextSnapshots[0]?.title).toBe("Headline snapshot");
  });

  it("uses the formatter fallback when discovery gathered outputs but forgot to commit context", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-backtest-context-formatter-"));
    const sessions = new SessionService(new AppSessionStore(path.join(dir, "app-sessions.json")));
    await sessions.createSession({ sessionId: "web:test", userId: "user", channel: "web" });
    const store = new BacktestStore(path.join(dir, "backtests.json"), path.join(dir, "runs"));
    let formatterRuns = 0;
    const piRuntime = {
      runEphemeral: async (params: {
        sessionKey: string;
        userPrompt?: string;
        customTools: Array<{ name: string; execute: Function }>;
      }) => {
        if (params.sessionKey.startsWith("backtest-prepare:")) {
          const commit = params.customTools.find((tool) => tool.name === "backtest_commit_prepared_data");
          const symbols = parseRequestedSymbols(params.userPrompt ?? "");
          const { dateFrom, dateTo } = parseDateWindow(params.userPrompt ?? "");
          await commit?.execute("tool-prepare", {
            provider: {
              server: "stub",
              historyTool: "get_historical_k_data",
              tradeDatesTool: "get_trade_dates",
            },
            calendar: buildCalendar(dateFrom, dateTo),
            warnings: [],
            barsBySymbol: Object.fromEntries(
              symbols.map((symbol) => [symbol, buildBarsForSymbol(symbol, dateFrom, dateTo)]),
            ),
          });
          return assistantRun(params.sessionKey, "prepared dataset");
        }
        if (params.sessionKey.endsWith(":formatter")) {
          formatterRuns += 1;
          const currentDate = parseCurrentTradingDate(params.userPrompt ?? "");
          const commit = params.customTools.find((tool) => tool.name === "backtest_commit_context");
          await commit?.execute("tool-context-format", {
            asOf: priorDate(currentDate),
            providerType: "skill",
            providerName: "formatter-skill",
            toolName: "formatter",
            title: "Formatted historical context",
            summary: "Formatter converted a discovered command result into the commit schema.",
            findings: ["Historical context was recovered from discovery output."],
            rawEvidence: ["historical discovery output"],
            payloadJson: JSON.stringify({ recovered: true }),
            warnings: [],
            symbols: ["AAPL.US"],
          });
          return assistantRun(params.sessionKey, "formatted context");
        }
        if (params.sessionKey.includes(":context:")) {
          const exec = params.customTools.find((tool) => tool.name === "exec_command");
          await exec?.execute("tool-context-discovery", {
            command: "Write-Output '{\"historical\":true,\"note\":\"discovery output present\"}'",
          });
          return assistantRun(params.sessionKey, "discovery finished without commit");
        }
        if (params.sessionKey.endsWith("2026-01-02")) {
          const context = params.customTools.find((tool) => tool.name === "backtest_request_context");
          await context?.execute("tool-context-1", {
            contextType: "news",
            objective: "Recover context through formatter fallback.",
            symbols: ["AAPL.US"],
            lookbackDays: 5,
            maxItems: 3,
          });
        }
        return assistantRun(params.sessionKey, "decision complete");
      },
    } as never;
    const service = new BacktestService(
      store,
      new BacktestJobStore(path.join(dir, "backtest-jobs.json"), path.join(dir, "jobs")),
      new BacktestNotifier(
        sessions,
        new MemoryService(path.join(dir, "memory")),
        {
          sendSystemNotice: async () => undefined,
        } as never,
      ),
      {
        listTools: () => [
          { server: "stub", name: "get_historical_k_data", description: "history" },
          { server: "stub", name: "get_trade_dates", description: "calendar" },
        ],
      } as never,
      piRuntime,
      new PromptRegistry("prompts"),
      new PortfolioStore(path.join(dir, "portfolio.json")),
      sessions,
      {
        workerLock: new BacktestWorkerLock(path.join(dir, "backtest-worker.lock.json")),
      },
    );

    const prepared = await service.prepareAsset(
      {
        symbol: "AAPL",
        dateFrom: "2026-01-02",
        dateTo: "2026-01-05",
        initialCash: 1000,
        spawnSpecialists: false,
      },
      {
        sessionId: "web:test",
        rootUserMessage: "请在发现额外上下文后提交历史快照。",
      },
    );
    const result = await service.runDataset(prepared.runId);
    const run = await store.getRun(prepared.runId);

    expect(result.status).toBe("completed");
    expect(formatterRuns).toBe(1);
    expect(run?.contextSnapshots).toHaveLength(1);
    expect(run?.contextSnapshots[0]?.providerName).toBe("formatter-skill");
    expect(run?.contextSnapshots[0]?.title).toBe("Formatted historical context");
  }, 10_000);

  it("retries Telegram delivery without duplicating the parent-session result", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-backtest-delivery-retry-"));
    const sessions = new SessionService(new AppSessionStore(path.join(dir, "app-sessions.json")));
    await sessions.createSession({ sessionId: "telegram:200", userId: "telegram:200", channel: "telegram" });
    let attempts = 0;
    const sendSystemNotice = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("telegram unavailable");
      }
    });
    const service = new BacktestService(
      new BacktestStore(path.join(dir, "backtests.json"), path.join(dir, "runs")),
      new BacktestJobStore(path.join(dir, "backtest-jobs.json"), path.join(dir, "jobs")),
      new BacktestNotifier(
        sessions,
        new MemoryService(path.join(dir, "memory")),
        {
          sendSystemNotice,
        } as never,
      ),
      {
        listTools: () => [
          { server: "stub", name: "get_historical_k_data", description: "history" },
          { server: "stub", name: "get_trade_dates", description: "calendar" },
        ],
        callTool: async (_server: string, toolName: string) => {
          if (toolName === "get_trade_dates") {
            return {
              server: "stub",
              name: toolName,
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    data: [
                      { calendar_date: "2026-01-02" },
                      { calendar_date: "2026-01-05" },
                    ],
                  }),
                },
              ],
            };
          }
          return {
            server: "stub",
            name: toolName,
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  data: [
                    { open: 100, high: 101, low: 99, close: 100, volume: 1000, turnover: 100000 },
                    { open: 101, high: 106, low: 100, close: 105, volume: 1100, turnover: 115500 },
                  ],
                }),
              },
            ],
          };
        },
      } as never,
      createPiRuntimeStub({
        onDay: async (params) => {
          if (params.sessionKey.endsWith("2026-01-02")) {
            const buy = params.customTools.find((tool) => tool.name === "paper_trade_buy");
            await buy?.execute("tool-1", {
              symbol: "AAPL.US",
              quantity: 1,
              rationale: "enter position",
            });
          }
        },
      }),
      new PromptRegistry("prompts"),
      new PortfolioStore(path.join(dir, "portfolio.json")),
      sessions,
      {
        workerLock: new BacktestWorkerLock(path.join(dir, "backtest-worker.lock.json")),
        deliveryRetryDelayMs: 30,
        workerPollIntervalMs: 10,
      },
    );
    await service.start();

    await service.submitAssetJob(
      {
        symbol: "AAPL",
        dateFrom: "2026-01-02",
        dateTo: "2026-01-05",
        initialCash: 1000,
        spawnSpecialists: false,
      },
      {
        sessionId: "telegram:200",
        requestId: "req-2",
        rootUserMessage: "回测 AAPL",
      },
    );

    let sawRetryWindow = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const snapshot = await service.getSessionJobsSnapshot("telegram:200");
      const job = snapshot.jobs[0];
      if (job?.sessionAppendedAt && !job.deliveredAt && job.deliveryAttemptCount === 1) {
        sawRetryWindow = true;
      }
      if (job?.deliveredAt) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    const snapshot = await service.getSessionJobsSnapshot("telegram:200");
    const job = snapshot.jobs[0];
    expect(sawRetryWindow).toBe(true);
    expect(job?.sessionAppendedAt).toBeTruthy();
    expect(job?.channelDeliveredAt).toBeTruthy();
    expect(job?.deliveredAt).toBeTruthy();
    expect(job?.nextDeliveryAttemptAt).toBeNull();
    expect(job?.deliveryAttemptCount).toBe(2);
    expect(job?.deliveryError).toBeNull();
    expect(sendSystemNotice).toHaveBeenCalledTimes(2);

    const session = await sessions.getSession("telegram:200");
    expect(session?.transcript.filter((entry) => entry.role === "assistant" && entry.content.includes("Backtest job")).length).toBe(1);

    await service.close();
  });

  it("writes a failure report file when preparation never commits market data", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-backtest-failed-report-"));
    const sessions = new SessionService(new AppSessionStore(path.join(dir, "app-sessions.json")));
    await sessions.createSession({ sessionId: "web:test", userId: "user", channel: "web" });
    const service = new BacktestService(
      new BacktestStore(path.join(dir, "backtests.json"), path.join(dir, "runs")),
      new BacktestJobStore(path.join(dir, "backtest-jobs.json"), path.join(dir, "jobs")),
      new BacktestNotifier(
        sessions,
        new MemoryService(path.join(dir, "memory")),
        {
          sendSystemNotice: async () => undefined,
        } as never,
      ),
      {
        listTools: () => [
          { server: "stub", name: "get_historical_k_data", description: "history" },
          { server: "stub", name: "get_trade_dates", description: "calendar" },
        ],
      } as never,
      {
        runEphemeral: async (params: { sessionKey: string }) => assistantRun(params.sessionKey, ""),
      } as never,
      new PromptRegistry("prompts"),
      new PortfolioStore(path.join(dir, "portfolio.json")),
      sessions,
      {
        workerLock: new BacktestWorkerLock(path.join(dir, "backtest-worker.lock.json")),
        workerPollIntervalMs: 10,
      },
    );
    await service.start();

    await service.submitAssetJob(
      {
        symbol: "AAPL",
        dateFrom: "2026-01-02",
        dateTo: "2026-01-05",
        initialCash: 1000,
        spawnSpecialists: false,
      },
      {
        sessionId: "web:test",
        requestId: "req-failed-report",
        rootUserMessage: "this prepare should fail",
      },
    );

    for (let attempt = 0; attempt < 50; attempt += 1) {
      const snapshot = await service.getSessionJobsSnapshot("web:test");
      if (snapshot.counts.failed === 1 && snapshot.jobs[0]?.deliveredAt) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    const snapshot = await service.getSessionJobsSnapshot("web:test");
    expect(snapshot.counts.failed).toBe(1);
    expect(snapshot.jobs[0]?.reportPath).toBeTruthy();
    const report = await readFile(snapshot.jobs[0]!.reportPath!, "utf8");
    expect(report).toContain("# Backtest Result");
    expect(report).toContain("## Error");
    expect(report).toContain("Backtest preparation did not commit market data");

    await service.close();
  });
});
