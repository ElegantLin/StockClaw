import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { TelegramBotApi, TelegramBotCommand, TelegramUpdate } from "../src/telegram/bot-api.js";
import type { TelegramConfig } from "../src/telegram/config.js";
import { TelegramPairingStore } from "../src/telegram/pairing-store.js";
import { TelegramExtension } from "../src/telegram/service.js";
import { TelegramStateStore } from "../src/state/telegram-state-store.js";

function createUnlockedPoller() {
  return {
    acquire: async () => ({ acquired: true, holderPid: null }),
    release: async () => {},
  };
}

describe("TelegramExtension", () => {
  it("adds an eye reaction to inbound Telegram messages before handling them", async () => {
    const reactions: Array<{ chatId: string; messageId: number; emoji: string }> = [];
    const updates: TelegramUpdate[] = [
      {
        update_id: 1,
        message: {
          message_id: 33,
          date: 1,
          text: "hello",
          chat: { id: 200, type: "private" },
          from: { id: 200, username: "alice" },
        },
      },
    ];
    const api: TelegramBotApi = {
      getMe: async () => ({ id: 999, username: "stockclawbot" }),
      getUpdates: async () => updates.splice(0),
      sendMessage: async () => {},
      setMessageReaction: async (chatId, messageId, reaction) => {
        reactions.push({ chatId, messageId, emoji: reaction[0]?.emoji ?? "" });
      },
      sendChatAction: async () => {},
      setMyCommands: async () => {},
    };
    const runtime = {
      getOrchestrator: vi.fn(async () => ({
        createSession: vi.fn(async () => ({})),
        handle: vi.fn(async () => ({
          intent: "chat",
          response: {
            requestId: "1",
            sessionId: "telegram:200",
            message: "ok",
            blocks: [],
            actions: [],
          },
        })),
      })),
    } as never;
    const config: TelegramConfig = {
      enabled: true,
      botToken: "token",
      adminChatId: "100",
      pollingTimeoutSeconds: 1,
      pollingIntervalMs: 5,
      pairing: { enabled: false, notifyAdmin: false },
    };

    const extension = new TelegramExtension(config, runtime, {
      api,
      pollerLock: createUnlockedPoller(),
    });
    await extension.start();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await extension.close();

    expect(reactions).toContainEqual({ chatId: "200", messageId: 33, emoji: "👀" });
  });

  it("sends Telegram replies with HTML parse mode and rendered code blocks", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-telegram-service-"));
    const sent: Array<{
      chatId: string;
      text: string;
      options?: { parseMode?: "HTML"; disableWebPagePreview?: boolean };
    }> = [];
    const updates: TelegramUpdate[] = [
      {
        update_id: 1,
        message: {
          message_id: 1,
          date: 1,
          text: "show me json",
          chat: { id: 200, type: "private" },
          from: { id: 200, username: "alice" },
        },
      },
    ];
    const api: TelegramBotApi = {
      getMe: async () => ({ id: 999, username: "stockclawbot" }),
      getUpdates: async () => updates.splice(0),
      sendMessage: async (chatId, text, options) => {
        sent.push({ chatId, text, options });
      },
      sendChatAction: async () => {},
      setMyCommands: async () => {},
    };
    const runtime = {
      getOrchestrator: vi.fn(async () => ({
        createSession: vi.fn(async () => ({})),
        handle: vi.fn(async () => ({
          intent: "chat",
          response: {
            requestId: "1",
            sessionId: "telegram:200",
            message: ["Result:", "", "```json", '{ "ok": true }', "```"].join("\n"),
            blocks: [],
            actions: [],
          },
        })),
      })),
    } as never;
    const config: TelegramConfig = {
      enabled: true,
      botToken: "token",
      adminChatId: "100",
      pollingTimeoutSeconds: 1,
      pollingIntervalMs: 5,
      pairing: { enabled: false, notifyAdmin: false },
    };

    const extension = new TelegramExtension(config, runtime, {
      api,
      pairing: new TelegramPairingStore(path.join(dir, "pairing.json")),
      pollerLock: createUnlockedPoller(),
    });
    await extension.start();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await extension.close();

    expect(sent.some((item) => item.chatId === "200" && item.options?.parseMode === "HTML")).toBe(true);
    expect(sent.some((item) => item.text.includes("<pre><code>"))).toBe(true);
  });

  it("requires pairing for unknown users and notifies the admin", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-telegram-service-"));
    const sent: Array<{ chatId: string; text: string }> = [];
    const actions: Array<{ chatId: string; action: string }> = [];
    const commands: Array<{ commands: TelegramBotCommand[]; scope?: Record<string, unknown> }> = [];
    const updates: TelegramUpdate[] = [
      {
        update_id: 1,
        message: {
          message_id: 1,
          date: 1,
          text: "hello",
          chat: { id: 200, type: "private" },
          from: { id: 200, username: "alice" },
        },
      },
    ];
    const api: TelegramBotApi = {
      getMe: async () => ({ id: 999, username: "stockclawbot" }),
      getUpdates: async () => updates.splice(0),
      sendMessage: async (chatId, text) => {
        sent.push({ chatId, text });
      },
      sendChatAction: async (chatId, action) => {
        actions.push({ chatId, action });
      },
      setMyCommands: async (nextCommands, scope) => {
        commands.push({ commands: nextCommands, scope });
      },
    };
    const orchestrator = {
      createSession: vi.fn(async () => ({})),
      handle: vi.fn(async () => ({
        intent: "chat",
        response: { requestId: "1", sessionId: "telegram:200", message: "ok", blocks: [], actions: [] },
      })),
    };
    const runtime = {
      getOrchestrator: vi.fn(async () => orchestrator),
    } as never;
    const config: TelegramConfig = {
      enabled: true,
      botToken: "token",
      adminChatId: "100",
      pollingTimeoutSeconds: 1,
      pollingIntervalMs: 5,
      pairing: { enabled: true, notifyAdmin: true },
    };

    const extension = new TelegramExtension(config, runtime, {
      api,
      pairing: new TelegramPairingStore(path.join(dir, "pairing.json")),
      pollerLock: createUnlockedPoller(),
    });

    await extension.start();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await extension.close();

    expect(orchestrator.handle).not.toHaveBeenCalled();
    expect(sent.some((item) => item.chatId === "200" && item.text.includes("Pairing code"))).toBe(true);
    expect(sent.some((item) => item.chatId === "200" && item.text.includes("telegram-admin -- approve"))).toBe(true);
    expect(sent.some((item) => item.chatId === "100" && item.text.includes("Approve locally"))).toBe(true);
    expect(commands.some((entry) => entry.commands.some((command) => command.command === "portfolio"))).toBe(true);
    expect(actions).toHaveLength(0);
  });

  it("does not crash startup if telegram bootstrap requests fail", async () => {
    const updates: TelegramUpdate[] = [];
    const api: TelegramBotApi = {
      getMe: async () => {
        throw new Error("connect timeout");
      },
      getUpdates: async () => updates.splice(0),
      sendMessage: async () => {},
      sendChatAction: async () => {},
      setMyCommands: async () => {
        throw new Error("setMyCommands timeout");
      },
    };
    const runtime = {
      getOrchestrator: vi.fn(async () => ({
        createSession: vi.fn(async () => ({})),
        handle: vi.fn(async () => ({
          intent: "chat",
          response: { requestId: "1", sessionId: "telegram:200", message: "ok", blocks: [], actions: [] },
        })),
      })),
    } as never;
    const config: TelegramConfig = {
      enabled: true,
      botToken: "token",
      adminChatId: "100",
      pollingTimeoutSeconds: 1,
      pollingIntervalMs: 5,
      pairing: { enabled: false, notifyAdmin: false },
    };

    const extension = new TelegramExtension(config, runtime, {
      api,
      pollerLock: createUnlockedPoller(),
    });

    await expect(extension.start()).resolves.toBeUndefined();
    await extension.close();
  });

  it("routes later messages into the orchestrator after local approval", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-telegram-service-"));
    const sent: Array<{ chatId: string; text: string }> = [];
    const actions: Array<{ chatId: string; action: string }> = [];
    const updates: TelegramUpdate[] = [
      {
        update_id: 2,
        message: {
          message_id: 2,
          date: 2,
          text: "analyze AAPL",
          chat: { id: 200, type: "private" },
          from: { id: 200, username: "alice" },
        },
      },
    ];
    const pairing = new TelegramPairingStore(path.join(dir, "pairing.json"));
    const pending = await pairing.upsertPending({ userId: "200", chatId: "200", username: "alice" });
    await pairing.approveByCode({ code: pending.code, approvedBy: "local-console" });

    const api: TelegramBotApi = {
      getMe: async () => ({ id: 999, username: "stockclawbot" }),
      getUpdates: async () => updates.splice(0),
      sendMessage: async (chatId, text) => {
        sent.push({ chatId, text });
      },
      sendChatAction: async (chatId, action) => {
        actions.push({ chatId, action });
      },
      setMyCommands: async () => {},
    };
    const orchestrator = {
      createSession: vi.fn(async () => ({})),
      handle: vi.fn(async () => ({
        intent: "investment_research",
        response: {
          requestId: "2",
          sessionId: "telegram:200",
          message: "AAPL looks constructive.",
          blocks: [],
          actions: [],
        },
      })),
    };
    const runtime = {
      getOrchestrator: vi.fn(async () => orchestrator),
    } as never;
    const config: TelegramConfig = {
      enabled: true,
      botToken: "token",
      adminChatId: "100",
      pollingTimeoutSeconds: 1,
      pollingIntervalMs: 5,
      pairing: { enabled: true, notifyAdmin: true },
    };

    const extension = new TelegramExtension(config, runtime, {
      api,
      pairing,
      pollerLock: createUnlockedPoller(),
    });
    await extension.start();
    await new Promise((resolve) => setTimeout(resolve, 35));
    await extension.close();

    expect(orchestrator.handle).toHaveBeenCalledTimes(1);
    expect(actions.some((item) => item.chatId === "200" && item.action === "typing")).toBe(true);
    expect(sent.some((item) => item.chatId === "200" && item.text.includes("AAPL looks constructive"))).toBe(true);
  });

  it("routes a photo-only message into the orchestrator with attachment metadata", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-telegram-service-"));
    const sent: Array<{ chatId: string; text: string }> = [];
    const updates: TelegramUpdate[] = [
      {
        update_id: 2,
        message: {
          message_id: 2,
          date: 2,
          chat: { id: 200, type: "private" },
          from: { id: 200, username: "alice" },
          photo: [
            { file_id: "small", width: 90, height: 90 },
            { file_id: "large", width: 1280, height: 720, file_size: 4096 },
          ],
        },
      },
    ];
    const pairing = new TelegramPairingStore(path.join(dir, "pairing.json"));
    const pending = await pairing.upsertPending({ userId: "200", chatId: "200", username: "alice" });
    await pairing.approveByCode({ code: pending.code, approvedBy: "local-console" });

    const api: TelegramBotApi = {
      getMe: async () => ({ id: 999, username: "stockclawbot" }),
      getUpdates: async () => updates.splice(0),
      sendMessage: async (chatId, text) => {
        sent.push({ chatId, text });
      },
      sendChatAction: async () => {},
      setMyCommands: async () => {},
    };
    const orchestrator = {
      createSession: vi.fn(async () => ({})),
      handle: vi.fn(async () => ({
        intent: "chat",
        response: {
          requestId: "2",
          sessionId: "telegram:200",
          message: "I received the image.",
          blocks: [],
          actions: [],
        },
      })),
    };
    const runtime = {
      getOrchestrator: vi.fn(async () => orchestrator),
    } as never;
    const config: TelegramConfig = {
      enabled: true,
      botToken: "token",
      adminChatId: "100",
      pollingTimeoutSeconds: 1,
      pollingIntervalMs: 5,
      pairing: { enabled: true, notifyAdmin: true },
    };

    const extension = new TelegramExtension(config, runtime, {
      api,
      pairing,
      pollerLock: createUnlockedPoller(),
    });
    await extension.start();
    await new Promise((resolve) => setTimeout(resolve, 35));
    await extension.close();

    expect(orchestrator.handle).toHaveBeenCalledTimes(1);
    const requestCalls = orchestrator.handle.mock.calls as unknown as Array<
      [{ message: string; metadata: Record<string, unknown> }]
    >;
    const request = requestCalls[0][0];
    expect(request.message).toContain("photo attachment");
    expect(Array.isArray(request.metadata.telegramAttachments)).toBe(true);
    expect(sent.some((item) => item.chatId === "200" && item.text.includes("received the image"))).toBe(true);
  });

  it("persists the offset so already processed updates are not replayed after restart", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-telegram-service-"));
    const sent: Array<{ chatId: string; text: string }> = [];
    const state = new TelegramStateStore(path.join(dir, "telegram-state.json"));
    const updates: TelegramUpdate[] = [
      {
        update_id: 10,
        message: {
          message_id: 1,
          date: 1,
          text: "analyze AAPL",
          chat: { id: 200, type: "private" },
          from: { id: 200, username: "alice" },
        },
      },
    ];
    const api: TelegramBotApi = {
      getMe: async () => ({ id: 999, username: "stockclawbot" }),
      getUpdates: async (offset) => updates.filter((item) => item.update_id >= offset),
      sendMessage: async (chatId, text) => {
        sent.push({ chatId, text });
      },
      sendChatAction: async () => {},
      setMyCommands: async () => {},
    };
    const orchestrator = {
      createSession: vi.fn(async () => ({})),
      handle: vi.fn(async () => ({
        intent: "investment_research",
        response: {
          requestId: "10",
          sessionId: "telegram:200",
          message: "AAPL once.",
          blocks: [],
          actions: [],
        },
      })),
    };
    const runtime = {
      getOrchestrator: vi.fn(async () => orchestrator),
    } as never;
    const config: TelegramConfig = {
      enabled: true,
      botToken: "token",
      adminChatId: "100",
      pollingTimeoutSeconds: 1,
      pollingIntervalMs: 5,
      pairing: { enabled: false, notifyAdmin: false },
    };

    const first = new TelegramExtension(config, runtime, {
      api,
      state,
      pollerLock: createUnlockedPoller(),
    });
    await first.start();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await first.close();

    const second = new TelegramExtension(config, runtime, {
      api,
      state,
      pollerLock: createUnlockedPoller(),
    });
    await second.start();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await second.close();

    expect(orchestrator.handle).toHaveBeenCalledTimes(1);
    expect(sent.filter((item) => item.text.includes("AAPL once.")).length).toBe(1);
  });

  it("returns the paper portfolio for /portfolio commands", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-telegram-service-"));
    const sent: Array<{ chatId: string; text: string }> = [];
    const updates: TelegramUpdate[] = [
      {
        update_id: 1,
        message: {
          message_id: 1,
          date: 1,
          text: "/portfolio",
          chat: { id: 200, type: "private" },
          from: { id: 200, username: "alice" },
        },
      },
    ];
    const api: TelegramBotApi = {
      getMe: async () => ({ id: 999, username: "stockclawbot" }),
      getUpdates: async () => updates.splice(0),
      sendMessage: async (chatId, text) => {
        sent.push({ chatId, text });
      },
      sendChatAction: async () => {},
      setMyCommands: async () => {},
    };
    const orchestrator = {
      createSession: vi.fn(async () => ({})),
      handle: vi.fn(),
      getPortfolioPayload: vi.fn(async () => ({
        snapshot: {
          accountId: "default",
          mode: "paper",
          cash: 1234.56,
          equity: 1500,
          buyingPower: 1500,
          positions: [
            {
              symbol: "AAPL.US",
              quantity: 2,
              avgCost: 250,
              marketPrice: 257.46,
              marketValue: 514.92,
              currency: "USD",
            },
          ],
          openOrders: [],
          updatedAt: "2026-03-08T00:00:00.000Z",
        },
        summary: "summary",
      })),
    };
    const runtime: any = {
      getOrchestrator: vi.fn(async () => orchestrator),
      inspect: vi.fn(),
    };
    const config: TelegramConfig = {
      enabled: true,
      botToken: "token",
      adminChatId: "100",
      pollingTimeoutSeconds: 1,
      pollingIntervalMs: 5,
      pairing: { enabled: false, notifyAdmin: false },
    };

    const extension = new TelegramExtension(config, runtime, {
      api,
      pairing: new TelegramPairingStore(path.join(dir, "pairing.json")),
      pollerLock: createUnlockedPoller(),
    });
    await extension.start();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await extension.close();

    expect(orchestrator.getPortfolioPayload).toHaveBeenCalledTimes(1);
    expect(orchestrator.handle).not.toHaveBeenCalled();
    expect(sent.some((item) => item.text.includes("Portfolio Snapshot"))).toBe(true);
    expect(sent.some((item) => item.text.includes("AAPL.US"))).toBe(true);
  });

  it("returns session status for /status", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-telegram-service-"));
    const sent: Array<{ chatId: string; text: string }> = [];
    const updates: TelegramUpdate[] = [
      {
        update_id: 1,
        message: {
          message_id: 1,
          date: 1,
          text: "/status",
          chat: { id: 200, type: "private" },
          from: { id: 200, username: "alice" },
        },
      },
    ];
    const api: TelegramBotApi = {
      getMe: async () => ({ id: 999, username: "stockclawbot" }),
      getUpdates: async () => updates.splice(0),
      sendMessage: async (chatId, text) => {
        sent.push({ chatId, text });
      },
      sendChatAction: async () => {},
      setMyCommands: async () => {},
    };
    const orchestrator = {
      getSessionStatus: vi.fn(async () => ({
        sessionId: "telegram:200",
        requestId: null,
        lastIntent: "investment_research",
        transcriptEntries: 6,
        sessionSummary: "User prefers low drawdown.",
        updatedAt: "2026-03-09T00:00:00.000Z",
        contextUsage: {
          contextTokens: 1800,
          source: "estimate",
          contextWindow: 128000,
          remainingTokens: 126200,
          percentUsed: 1,
          compactionThresholdTokens: 76800,
        },
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
        specialistCount: 2,
        specialists: [
          { role: "value_analyst", sessionId: "s1", message: "m1", toolCalls: [] },
          { role: "risk_manager", sessionId: "s2", message: "m2", toolCalls: [] },
        ],
        backtests: {
          queued: 1,
          preparing: 0,
          running: 1,
          completed: 2,
          failed: 0,
          active: 2,
          jobs: [
            {
              jobId: "job-2",
              status: "running",
              kind: "portfolio",
              symbols: ["AAPL.US", "MSFT.US"],
              dateFrom: "2026-03-01",
              dateTo: "2026-03-11",
              runId: "run-2",
              datasetId: "dataset-2",
              submittedAt: "2026-03-09T01:00:00.000Z",
              startedAt: "2026-03-09T00:00:01.000Z",
              completedAt: null,
              deliveredAt: null,
              reportSummary: null,
              error: null,
            },
            {
              jobId: "job-1",
              status: "completed",
              kind: "asset",
              symbols: ["AAPL.US"],
              dateFrom: "2026-03-01",
              dateTo: "2026-03-05",
              runId: "run-1",
              datasetId: "dataset-1",
              submittedAt: "2026-03-08T00:00:00.000Z",
              startedAt: "2026-03-08T00:00:01.000Z",
              completedAt: "2026-03-08T00:10:00.000Z",
              deliveredAt: "2026-03-08T00:11:00.000Z",
              reportSummary: "Return 1.20%",
              error: null,
            },
          ],
        },
        crons: {
          total: 1,
          active: 1,
          running: 0,
          jobs: [
            {
              jobId: "cron-1",
              name: "hourly portfolio review",
              enabled: true,
              updatedAt: "2026-03-09T00:00:00.000Z",
              nextRunAt: "2026-03-09T01:00:00.000Z",
              lastOutcome: "succeeded",
            },
          ],
        },
      })),
    };
    const runtime: any = {
      getOrchestrator: vi.fn(async () => orchestrator),
      inspect: vi.fn(async () => ({
        status: {
          startedAt: "2026-03-09T00:00:00.000Z",
          lastReloadAt: null,
          lastReloadReason: null,
          reloadCount: 0,
          reloadInFlight: false,
          pendingReason: null,
          lastError: null,
        },
        cron: {
          enabled: true,
          jobCount: 0,
          activeJobCount: 0,
          runningJobCount: 0,
          lastTickAt: null,
          jobs: [],
        },
        skills: [],
        mcp: [],
        recentMemory: [],
      })),
    };
    const config: TelegramConfig = {
      enabled: true,
      botToken: "token",
      adminChatId: "100",
      pollingTimeoutSeconds: 1,
      pollingIntervalMs: 5,
      pairing: { enabled: false, notifyAdmin: false },
    };

    const extension = new TelegramExtension(config, runtime, {
      api,
      pairing: new TelegramPairingStore(path.join(dir, "pairing.json")),
      pollerLock: createUnlockedPoller(),
    });
    await extension.start();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await extension.close();

    expect(orchestrator.getSessionStatus).toHaveBeenCalledTimes(1);
    expect(sent.some((item) => item.text.includes("Session Status"))).toBe(true);
    expect(sent.some((item) => item.text.includes("Context Tokens"))).toBe(true);
    expect(sent.some((item) => item.text.includes("value_analyst"))).toBe(true);
    expect(sent.some((item) => item.text.includes("Backtests"))).toBe(true);
    expect(sent.some((item) => item.text.includes("job-2"))).toBe(true);
    expect(sent.some((item) => item.text.includes("/backtests"))).toBe(true);
    expect(sent.some((item) => item.text.includes("Latest Cron Job"))).toBe(true);
    expect(sent.some((item) => item.text.includes("/cron"))).toBe(true);
    expect(sent.some((item) => item.text.includes("job-1"))).toBe(false);
  });

  it("manually compacts the current chat for /compact", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-telegram-service-"));
    const sent: Array<{ chatId: string; text: string }> = [];
    const updates: TelegramUpdate[] = [
      {
        update_id: 1,
        message: {
          message_id: 1,
          date: 1,
          text: "/compact",
          chat: { id: 200, type: "private" },
          from: { id: 200, username: "alice" },
        },
      },
    ];
    const api: TelegramBotApi = {
      getMe: async () => ({ id: 999, username: "stockclawbot" }),
      getUpdates: async () => updates.splice(0),
      sendMessage: async (chatId, text) => {
        sent.push({ chatId, text });
      },
      sendChatAction: async () => {},
      setMyCommands: async () => {},
    };
    const orchestrator = {
      compactSession: vi.fn(async () => ({
        ok: true,
        message: "The active session context was compacted successfully.",
      })),
    };
    const runtime: any = {
      getOrchestrator: vi.fn(async () => orchestrator),
      inspect: vi.fn(),
    };
    const config: TelegramConfig = {
      enabled: true,
      botToken: "token",
      adminChatId: "100",
      pollingTimeoutSeconds: 1,
      pollingIntervalMs: 5,
      pairing: { enabled: false, notifyAdmin: false },
    };

    const extension = new TelegramExtension(config, runtime, {
      api,
      pairing: new TelegramPairingStore(path.join(dir, "pairing.json")),
      pollerLock: createUnlockedPoller(),
    });
    await extension.start();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await extension.close();

    expect(orchestrator.compactSession).toHaveBeenCalledWith("telegram:200");
    expect(sent.some((item) => item.text.includes("compacted successfully"))).toBe(true);
  });

  it("returns full backtest history for /backtests", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-telegram-service-"));
    const sent: Array<{ chatId: string; text: string }> = [];
    const updates: TelegramUpdate[] = [
      {
        update_id: 1,
        message: {
          message_id: 1,
          date: 1,
          text: "/backtests",
          chat: { id: 200, type: "private" },
          from: { id: 200, username: "alice" },
        },
      },
    ];
    const api: TelegramBotApi = {
      getMe: async () => ({ id: 999, username: "stockclawbot" }),
      getUpdates: async () => updates.splice(0),
      sendMessage: async (chatId, text) => {
        sent.push({ chatId, text });
      },
      sendChatAction: async () => {},
      setMyCommands: async () => {},
    };
    const orchestrator = {
      getSessionBacktests: vi.fn(async () => ({
        counts: {
          queued: 1,
          preparing: 0,
          running: 1,
          completed: 1,
          failed: 0,
          active: 2,
        },
        jobs: [
          {
            jobId: "job-2",
            status: "running",
            kind: "portfolio",
            symbols: ["MSFT.US"],
            dateFrom: "2026-03-03",
            dateTo: "2026-03-11",
            runId: "run-2",
            datasetId: "dataset-2",
            submittedAt: "2026-03-09T01:00:00.000Z",
            startedAt: "2026-03-09T01:01:00.000Z",
            completedAt: null,
            deliveredAt: null,
            reportSummary: null,
            error: null,
          },
          {
            jobId: "job-1",
            status: "completed",
            kind: "asset",
            symbols: ["AAPL.US"],
            dateFrom: "2026-03-01",
            dateTo: "2026-03-05",
            runId: "run-1",
            datasetId: "dataset-1",
            submittedAt: "2026-03-08T00:00:00.000Z",
            startedAt: "2026-03-08T00:00:01.000Z",
            completedAt: "2026-03-08T00:10:00.000Z",
            deliveredAt: "2026-03-08T00:11:00.000Z",
            reportSummary: "Return 1.20%",
            error: null,
          },
        ],
      })),
    };
    const runtime: any = {
      getOrchestrator: vi.fn(async () => orchestrator),
      inspect: vi.fn(),
    };
    const config: TelegramConfig = {
      enabled: true,
      botToken: "token",
      adminChatId: "100",
      pollingTimeoutSeconds: 1,
      pollingIntervalMs: 5,
      pairing: { enabled: false, notifyAdmin: false },
    };

    const extension = new TelegramExtension(config, runtime, {
      api,
      pairing: new TelegramPairingStore(path.join(dir, "pairing.json")),
      pollerLock: createUnlockedPoller(),
    });
    await extension.start();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await extension.close();

    expect(orchestrator.getSessionBacktests).toHaveBeenCalledTimes(1);
    expect(sent.some((item) => item.text.includes("Backtest Jobs"))).toBe(true);
    expect(sent.some((item) => item.text.includes("job-2"))).toBe(true);
    expect(sent.some((item) => item.text.includes("job-1"))).toBe(true);
  });

  it("returns runtime status for the admin /runtime command", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-telegram-service-"));
    const sent: Array<{ chatId: string; text: string }> = [];
    const updates: TelegramUpdate[] = [
      {
        update_id: 1,
        message: {
          message_id: 1,
          date: 1,
          text: "/runtime",
          chat: { id: 100, type: "private" },
          from: { id: 100, username: "owner" },
        },
      },
    ];
    const api: TelegramBotApi = {
      getMe: async () => ({ id: 999, username: "stockclawbot" }),
      getUpdates: async () => updates.splice(0),
      sendMessage: async (chatId, text) => {
        sent.push({ chatId, text });
      },
      sendChatAction: async () => {},
      setMyCommands: async () => {},
    };
    const runtime: any = {
      getOrchestrator: vi.fn(),
      inspect: vi.fn(async () => ({
        status: {
          startedAt: "2026-03-08T00:00:00.000Z",
          lastReloadAt: "2026-03-08T01:00:00.000Z",
          lastReloadReason: "manual",
          reloadCount: 1,
          reloadInFlight: false,
          pendingReason: null,
          lastError: null,
        },
        cron: {
          enabled: true,
          jobCount: 2,
          activeJobCount: 1,
          runningJobCount: 0,
          lastTickAt: "2026-03-08T01:05:00.000Z",
        },
        skills: [{ name: "mcporter", description: "desc", location: "skills/mcporter/SKILL.md" }],
        mcp: [{ server: "longport", toolCount: 8 }],
        recentMemory: [],
      })),
    };
    const config: TelegramConfig = {
      enabled: true,
      botToken: "token",
      adminChatId: "100",
      pollingTimeoutSeconds: 1,
      pollingIntervalMs: 5,
      pairing: { enabled: false, notifyAdmin: false },
    };

    const extension = new TelegramExtension(config, runtime, {
      api,
      pairing: new TelegramPairingStore(path.join(dir, "pairing.json")),
      pollerLock: createUnlockedPoller(),
    });
    await extension.start();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await extension.close();

    expect(runtime.inspect).toHaveBeenCalledTimes(1);
    expect(sent.some((item) => item.text.includes("Runtime Status"))).toBe(true);
    expect(sent.some((item) => item.text.includes("Cron"))).toBe(true);
    expect(sent.some((item) => item.text.includes("longport"))).toBe(true);
    expect(sent.some((item) => item.text.includes("mcporter"))).toBe(true);
  });

  it("returns cron state for the admin /cron command", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-telegram-service-"));
    const sent: Array<{ chatId: string; text: string }> = [];
    const updates: TelegramUpdate[] = [
      {
        update_id: 1,
        message: {
          message_id: 1,
          date: 1,
          text: "/cron",
          chat: { id: 100, type: "private" },
          from: { id: 100, username: "owner" },
        },
      },
    ];
    const api: TelegramBotApi = {
      getMe: async () => ({ id: 999, username: "stockclawbot" }),
      getUpdates: async () => updates.splice(0),
      sendMessage: async (chatId, text) => {
        sent.push({ chatId, text });
      },
      sendChatAction: async () => {},
      setMyCommands: async () => {},
    };
    const orchestrator = {
      inspectCron: vi.fn(async () => ({
        status: {
          enabled: true,
          jobCount: 1,
          activeJobCount: 1,
          runningJobCount: 0,
          lastTickAt: null,
        },
        jobs: [
          {
            id: "job-1",
            name: "watch-aapl",
            enabled: true,
            state: {
              nextRunAt: "2026-03-08T02:00:00.000Z",
              lastOutcome: "idle",
            },
          },
        ],
      })),
    };
    const runtime: any = {
      getOrchestrator: vi.fn(async () => orchestrator),
      inspect: vi.fn(),
    };
    const config: TelegramConfig = {
      enabled: true,
      botToken: "token",
      adminChatId: "100",
      pollingTimeoutSeconds: 1,
      pollingIntervalMs: 5,
      pairing: { enabled: false, notifyAdmin: false },
    };

    const extension = new TelegramExtension(config, runtime, {
      api,
      pairing: new TelegramPairingStore(path.join(dir, "pairing.json")),
      pollerLock: createUnlockedPoller(),
    });
    await extension.start();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await extension.close();

    expect(orchestrator.inspectCron).toHaveBeenCalledTimes(1);
    expect(sent.some((item) => item.text.includes("Cron Scheduler"))).toBe(true);
    expect(sent.some((item) => item.text.includes("watch-aapl"))).toBe(true);
  });

  it("schedules a daemon restart for the admin /restart command", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-telegram-service-"));
    const sent: Array<{ chatId: string; text: string }> = [];
    const updates: TelegramUpdate[] = [
      {
        update_id: 1,
        message: {
          message_id: 1,
          date: 1,
          text: "/restart",
          chat: { id: 100, type: "private" },
          from: { id: 100, username: "owner" },
        },
      },
    ];
    const api: TelegramBotApi = {
      getMe: async () => ({ id: 999, username: "stockclawbot" }),
      getUpdates: async () => updates.splice(0),
      sendMessage: async (chatId, text) => {
        sent.push({ chatId, text });
      },
      sendChatAction: async () => {},
      setMyCommands: async () => {},
    };
    const orchestrator = {
      requestRestart: vi.fn(async () => ({
        ok: true,
        action: "restart_runtime",
        message: "stock-claw restart scheduled.",
      })),
    };
    const runtime: any = {
      getOrchestrator: vi.fn(async () => orchestrator),
      inspect: vi.fn(),
    };
    const config: TelegramConfig = {
      enabled: true,
      botToken: "token",
      adminChatId: "100",
      pollingTimeoutSeconds: 1,
      pollingIntervalMs: 5,
      pairing: { enabled: false, notifyAdmin: false },
    };

    const extension = new TelegramExtension(config, runtime, {
      api,
      pairing: new TelegramPairingStore(path.join(dir, "pairing.json")),
      pollerLock: createUnlockedPoller(),
    });
    await extension.start();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await extension.close();

    expect(orchestrator.requestRestart).toHaveBeenCalledTimes(1);
    expect(sent.some((item) => item.text.includes("restart scheduled"))).toBe(true);
  });

  it("registers admin-scoped slash commands when an admin chat is configured", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-telegram-service-"));
    const updates: TelegramUpdate[] = [];
    const commandRegistrations: Array<{ commands: TelegramBotCommand[]; scope?: Record<string, unknown> }> = [];
    const api: TelegramBotApi = {
      getMe: async () => ({ id: 999, username: "stockclawbot" }),
      getUpdates: async () => updates.splice(0),
      sendMessage: async () => {},
      sendChatAction: async () => {},
      setMyCommands: async (commands, scope) => {
        commandRegistrations.push({ commands, scope });
      },
    };
    const runtime = {
      getOrchestrator: vi.fn(),
    } as never;
    const config: TelegramConfig = {
      enabled: true,
      botToken: "token",
      adminChatId: "100",
      pollingTimeoutSeconds: 1,
      pollingIntervalMs: 5,
      pairing: { enabled: false, notifyAdmin: false },
    };

    const extension = new TelegramExtension(config, runtime, {
      api,
      pairing: new TelegramPairingStore(path.join(dir, "pairing.json")),
      pollerLock: createUnlockedPoller(),
    });
    await extension.start();
    await new Promise((resolve) => setTimeout(resolve, 15));
    await extension.close();

    expect(commandRegistrations.length).toBe(2);
    expect(commandRegistrations[0]?.commands.some((command) => command.command === "backtests")).toBe(true);
    expect(commandRegistrations[0]?.commands.some((command) => command.command === "compact")).toBe(true);
    expect(commandRegistrations[0]?.commands.some((command) => command.command === "portfolio")).toBe(true);
    expect(commandRegistrations[1]?.commands.some((command) => command.command === "runtime")).toBe(true);
    expect(commandRegistrations[1]?.commands.some((command) => command.command === "cron")).toBe(true);
    expect(commandRegistrations[1]?.commands.some((command) => command.command === "restart")).toBe(true);
    expect(commandRegistrations[1]?.scope).toMatchObject({ type: "chat", chat_id: "100" });
  });

  it("does not expose remote pairing slash commands", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-telegram-service-"));
    const commandRegistrations: Array<{ commands: TelegramBotCommand[]; scope?: Record<string, unknown> }> = [];
    const api: TelegramBotApi = {
      getMe: async () => ({ id: 999, username: "stockclawbot" }),
      getUpdates: async () => [],
      sendMessage: async () => {},
      sendChatAction: async () => {},
      setMyCommands: async (commands, scope) => {
        commandRegistrations.push({ commands, scope });
      },
    };
    const runtime = {
      getOrchestrator: vi.fn(),
    } as never;
    const config: TelegramConfig = {
      enabled: true,
      botToken: "token",
      adminChatId: null,
      pollingTimeoutSeconds: 1,
      pollingIntervalMs: 5,
      pairing: { enabled: true, notifyAdmin: false },
    };

    const extension = new TelegramExtension(config, runtime, {
      api,
      pairing: new TelegramPairingStore(path.join(dir, "pairing.json")),
      pollerLock: createUnlockedPoller(),
    });
    await extension.start();
    await new Promise((resolve) => setTimeout(resolve, 15));
    await extension.close();

    const allCommands = commandRegistrations.flatMap((entry) => entry.commands.map((command) => command.command));
    expect(allCommands).not.toContain("pair");
    expect(allCommands).not.toContain("pair-admin");
  });

  it("sends a file to the current Telegram chat with an explicit mime type", async () => {
    const documents: Array<{
      chatId: string;
      document: { fileName: string; content: string };
      options?: { caption?: string; parseMode?: "HTML"; mimeType?: string };
    }> = [];
    const api: TelegramBotApi = {
      getMe: async () => ({ id: 999, username: "stockclawbot" }),
      getUpdates: async () => [],
      sendMessage: async () => {},
      sendDocument: async (chatId, document, options) => {
        documents.push({ chatId, document, options });
      },
      sendChatAction: async () => {},
      setMyCommands: async () => {},
    };
    const runtime = {
      getOrchestrator: vi.fn(),
    } as never;
    const config: TelegramConfig = {
      enabled: true,
      botToken: "token",
      adminChatId: "100",
      pollingTimeoutSeconds: 1,
      pollingIntervalMs: 5,
      pairing: { enabled: false, notifyAdmin: false },
    };
    const extension = new TelegramExtension(config, runtime, {
      api,
      pollerLock: createUnlockedPoller(),
    });

    const result = await extension.sendSessionFile("telegram:200", {
      fileName: "../analysis.html",
      content: "# Result\n\nAAPL looks constructive.",
      caption: "Analysis attached",
      mimeType: "text/html; charset=utf-8",
    });

    expect(result).toEqual({
      sessionId: "telegram:200",
      chatId: "200",
      fileName: "analysis.html",
    });
    expect(documents).toHaveLength(1);
    expect(documents[0]?.document.fileName).toBe("analysis.html");
    expect(documents[0]?.options?.parseMode).toBe("HTML");
    expect(documents[0]?.options?.mimeType).toBe("text/html; charset=utf-8");
  });

  it("sends an explicit Telegram reaction to a session message", async () => {
    const reactions: Array<{ chatId: string; messageId: number; emoji: string; isBig?: boolean }> = [];
    const api: TelegramBotApi = {
      getMe: async () => ({ id: 999, username: "stockclawbot" }),
      getUpdates: async () => [],
      sendMessage: async () => {},
      setMessageReaction: async (chatId, messageId, reaction, options) => {
        reactions.push({
          chatId,
          messageId,
          emoji: reaction[0]?.emoji ?? "",
          isBig: options?.isBig,
        });
      },
      sendChatAction: async () => {},
      setMyCommands: async () => {},
    };
    const runtime = {
      getOrchestrator: vi.fn(),
    } as never;
    const config: TelegramConfig = {
      enabled: true,
      botToken: "token",
      adminChatId: "100",
      pollingTimeoutSeconds: 1,
      pollingIntervalMs: 5,
      pairing: { enabled: false, notifyAdmin: false },
    };
    const extension = new TelegramExtension(config, runtime, {
      api,
      pollerLock: createUnlockedPoller(),
    });

    const result = await extension.sendSessionReaction("telegram:200", {
      messageId: 77,
      emoji: "👍",
      isBig: true,
    });

    expect(result).toEqual({
      sessionId: "telegram:200",
      chatId: "200",
      messageId: 77,
      emoji: "👍",
    });
    expect(reactions).toContainEqual({
      chatId: "200",
      messageId: 77,
      emoji: "👍",
      isBig: true,
    });
  });

  it("downloads the current Telegram attachment into local runtime storage", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-telegram-download-"));
    const api: TelegramBotApi = {
      getMe: async () => ({ id: 999, username: "stockclawbot" }),
      getUpdates: async () => [],
      getFile: async (fileId) => ({
        file_id: fileId,
        file_path: "photos/chart-file.jpg",
      }),
      downloadFile: async () => new TextEncoder().encode("telegram-image-bytes"),
      sendMessage: async () => {},
      sendChatAction: async () => {},
      setMyCommands: async (_commands: TelegramBotCommand[]) => {},
    };
    const extension = new TelegramExtension(
      {
        enabled: true,
        botToken: "token",
        adminChatId: "200",
        pollingTimeoutSeconds: 1,
        pollingIntervalMs: 1,
        pairing: { enabled: true, notifyAdmin: true },
      } satisfies TelegramConfig,
      {} as never,
      {
        api,
        downloadRoot: dir,
        pollerLock: createUnlockedPoller(),
      },
    );

    const result = await extension.downloadSessionAttachment("telegram:200", {
      messageId: 55,
      requestMetadata: {
        telegramAttachments: [
          {
            kind: "photo",
            fileId: "file-123",
            fileName: "position-chart.jpg",
            mimeType: "image/jpeg",
          },
        ],
      },
    });

    expect(result.sessionId).toBe("telegram:200");
    expect(result.chatId).toBe("200");
    expect(result.messageId).toBe(55);
    expect(result.fileName).toBe("position-chart.jpg");
    expect(result.savedPath).toContain(path.join("200", "55", "position-chart.jpg"));
    expect(await readFile(result.savedPath, "utf8")).toBe("telegram-image-bytes");
  });
});
