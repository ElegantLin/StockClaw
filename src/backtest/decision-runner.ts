import { randomUUID } from "node:crypto";

import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";

import { buildPortfolioSummary } from "../memory/summary.js";
import type { PiRuntime } from "../pi/runtime.js";
import type { PromptRegistry } from "../prompts/registry.js";
import type { PortfolioSnapshot, SpecialistResult } from "../types.js";
import type { BacktestTraceSink } from "./artifacts.js";
import { BacktestContextResolverService } from "./context-resolver.js";
import type { BacktestContextRequest, BacktestContextSnapshot, BacktestDataset, BacktestDecisionSession, BacktestFillRecord, BacktestTradeExecutionResult, BacktestTradeIntent, BacktestWindow } from "./types.js";
import { runWithBacktestTransientRetry } from "./runtime-retry.js";
import { applyBacktestTrade, buildClosePriceMap, createInitialBacktestPortfolio, findBarForDate, markPortfolioToMarket } from "./state.js";

const SPAWNABLE_SPECIALISTS = new Set([
  "value_analyst",
  "technical_analyst",
  "news_sentiment_analyst",
  "risk_manager",
] as const);

export class BacktestDecisionRunner {
  constructor(
    private readonly piRuntime: PiRuntime,
    private readonly prompts: PromptRegistry,
    private readonly contextResolver: BacktestContextResolverService,
  ) {}

  async runDay(params: {
    runId: string;
    dataset: BacktestDataset;
    date: string;
    portfolio: PortfolioSnapshot;
    trace?: BacktestTraceSink | null;
  }): Promise<{
    portfolio: PortfolioSnapshot;
    fills: BacktestFillRecord[];
    decisionSession: BacktestDecisionSession;
  }> {
    const sessionId = `backtest:${params.runId}:${params.date}`;
    const requestId = randomUUID();
    const window = buildWindow(params.dataset, params.date);
    const existingContexts = await this.contextResolver.listDayContexts(params.runId, params.date);
    const tradeRecorder = new BacktestTradeRecorder(params.dataset, params.date, sessionId, params.portfolio);
    const specialistController = new BacktestSpecialistController({
      piRuntime: this.piRuntime,
      prompts: this.prompts,
      dataset: params.dataset,
      date: params.date,
      rootSessionId: sessionId,
      requestId,
      portfolio: params.portfolio,
      window,
      trace: params.trace ?? null,
      getContextSnapshots: () => this.contextResolver.listDayContexts(params.runId, params.date),
    });
    await params.trace?.log({
      type: "day_started",
      data: {
        date: params.date,
        sessionId,
        cash: params.portfolio.cash,
        equity: params.portfolio.equity,
        positions: params.portfolio.positions.map((position) => ({
          symbol: position.symbol,
          quantity: position.quantity,
        })),
      },
    });
    const run = await runWithBacktestTransientRetry({
      operation: "backtest_day_root",
      sessionId,
      trace: params.trace ?? null,
      run: async () =>
        this.piRuntime.runEphemeral({
          sessionKey: sessionId,
          systemPrompt: await this.buildSystemPrompt(),
          userPrompt: this.buildRootUserPrompt(params.dataset, params.date, params.portfolio, window, existingContexts),
          customTools: [
            portfolioReadTool(() => tradeRecorder.currentPortfolio, params.trace ?? null, params.date),
            portfolioSummaryTool(() => tradeRecorder.currentPortfolio, params.trace ?? null, params.date),
            paperTradeTool("buy", (trade) => tradeRecorder.executeTrade(trade), params.trace ?? null, params.date),
            paperTradeTool("sell", (trade) => tradeRecorder.executeTrade(trade), params.trace ?? null, params.date),
            backtestRequestContextTool({
              resolver: this.contextResolver,
              runId: params.runId,
              dataset: params.dataset,
              date: params.date,
              rootSessionId: sessionId,
              rootUserMessage: params.dataset.rootUserMessage,
              getPortfolio: () => tradeRecorder.currentPortfolio,
              getWindow: () => buildWindow(params.dataset, params.date),
              trace: params.trace ?? null,
            }),
            ...(params.dataset.executionPolicy.spawnSpecialists ? specialistController.createTools() : []),
          ],
        }),
    });
    await params.trace?.log({
      type: "root_completed",
      data: {
        date: params.date,
        sessionId,
        message: run.message,
        toolCalls: run.toolCalls,
        specialistCount: specialistController.results.length,
      },
    });

    const marked = markPortfolioToMarket({
      portfolio: tradeRecorder.currentPortfolio,
      date: `${params.date}T00:00:00.000Z`,
      closePrices: buildClosePriceMap(params.dataset.barsBySymbol, params.date),
    });
    const nextPortfolio = createInitialBacktestPortfolio(marked);
    await params.trace?.log({
      type: "day_completed",
      data: {
        date: params.date,
        sessionId,
        filledTrades: tradeRecorder.fills.filter((fill) => fill.status === "filled"),
        rejectedTrades: tradeRecorder.fills.filter((fill) => fill.status === "rejected"),
        cash: nextPortfolio.cash,
        equity: nextPortfolio.equity,
      },
    });
    return {
      portfolio: nextPortfolio,
      fills: tradeRecorder.fills,
      decisionSession: {
        date: params.date,
        sessionId,
        requestId,
        rootMessage: run.message,
        toolCalls: run.toolCalls,
        specialists: specialistController.results,
        usage: run.usage,
        createdAt: new Date().toISOString(),
      },
    };
  }

  private async buildSystemPrompt(): Promise<string> {
    const base = await this.prompts.composeAgentPrompt("orchestrator");
    const workflow = await this.prompts.composeWorkflowPrompt("backtest_mode");
    return [base, workflow].filter(Boolean).join("\n\n").trim();
  }

  private buildRootUserPrompt(
    dataset: BacktestDataset,
    date: string,
    portfolio: PortfolioSnapshot,
    window: BacktestWindow,
    contextSnapshots: BacktestContextSnapshot[],
  ): string {
    const tradableSymbols = dataset.symbols.filter((symbol) => findBarForDate(dataset.barsBySymbol, symbol, date));
    const contextSection =
      contextSnapshots.length === 0
        ? "(none cached yet for this trading day)"
        : JSON.stringify(
            contextSnapshots.map((snapshot) => ({
              contextType: snapshot.request.contextType,
              objective: snapshot.request.objective,
              symbols: snapshot.symbols,
              asOf: snapshot.asOf,
              providerType: snapshot.providerType,
              providerName: snapshot.providerName,
              toolName: snapshot.toolName,
              title: snapshot.title,
              summary: snapshot.summary,
              warnings: snapshot.warnings,
            })),
            null,
            2,
          );
    return [
      `Original user request: ${dataset.rootUserMessage}`,
      "",
      `Backtest run: ${dataset.runId}`,
      `Current trading date: ${date}`,
      `Current date is part of a historical backtest. You may only use the provided history window and the backtest-scoped tools in this session.`,
      dataset.kind === "asset"
        ? "This run starts from cash unless the current portfolio snapshot below shows otherwise."
        : "The current portfolio snapshot below already contains the requested starting holdings. Do not place buy orders just to initialize or recreate those positions.",
      "",
      "Execution rules:",
      "- If you buy, the engine will fill at today's open price.",
      "- If you sell, the engine will fill at today's close price.",
      "- You cannot inspect today's open or close directly before deciding.",
      "- Do not use hindsight or assume future knowledge.",
      dataset.kind === "asset"
        ? "- If you want exposure, explicitly decide to trade."
        : "- Only use paper_trade_buy or paper_trade_sell if you intentionally want to change the starting portfolio after the backtest begins.",
      "",
      `Tradable symbols today: ${tradableSymbols.join(", ") || "(none)"}`,
      "",
      "Current portfolio snapshot:",
      JSON.stringify(portfolio, null, 2),
      "",
      "Visible historical data window (up to the prior trading day only):",
      JSON.stringify(window, null, 2),
      "",
      "Cached historical context snapshots already resolved for this trading day:",
      contextSection,
      "",
      "Decide whether to hold, buy, or sell. Use paper_trade_buy / paper_trade_sell only when you want to record a trade in this backtest. If you need more historical context, use backtest_request_context. If you need another reasoning lens, use sessions_spawn.",
      "Do not tell the user to invoke backtest tools again. The backtest is already running and this session is only deciding for the current trading date.",
    ].join("\n");
  }
}

class BacktestTradeRecorder {
  currentPortfolio: PortfolioSnapshot;
  readonly fills: BacktestFillRecord[] = [];

  constructor(
    private readonly dataset: BacktestDataset,
    private readonly date: string,
    private readonly sessionId: string,
    portfolio: PortfolioSnapshot,
  ) {
    this.currentPortfolio = createInitialBacktestPortfolio(portfolio);
  }

  async executeTrade(trade: BacktestTradeIntent): Promise<BacktestTradeExecutionResult> {
    const timestamp = new Date().toISOString();
    const { portfolio, fill } = applyBacktestTrade({
      dataset: this.dataset,
      portfolio: this.currentPortfolio,
      date: this.date,
      trade,
      bar: findBarForDate(this.dataset.barsBySymbol, trade.symbol, this.date),
      sessionId: this.sessionId,
      timestamp,
    });
    this.currentPortfolio = portfolio;
    this.fills.push(fill);
    return {
      status: fill.status,
      symbol: fill.symbol,
      side: fill.side,
      quantity: fill.quantity,
      message:
        fill.status === "filled"
          ? `Backtest ${fill.side} recorded for ${fill.quantity} shares of ${fill.symbol}.`
          : fill.reason || `Backtest ${fill.side} rejected for ${fill.symbol}.`,
    };
  }
}

class BacktestSpecialistController {
  readonly results: SpecialistResult[] = [];

  constructor(
    private readonly params: {
      piRuntime: PiRuntime;
      prompts: PromptRegistry;
      dataset: BacktestDataset;
      date: string;
      rootSessionId: string;
      requestId: string;
      portfolio: PortfolioSnapshot;
      window: BacktestWindow;
      trace: BacktestTraceSink | null;
      getContextSnapshots(): Promise<BacktestContextSnapshot[]>;
    },
  ) {}

  createTools(): ToolDefinition[] {
    return [
      {
        name: "sessions_spawn",
        label: "Sessions Spawn",
        description:
          "Spawn a specialist to reason about the provided backtest context only. Specialists in backtest mode cannot fetch external data.",
        parameters: Type.Object({
          profileId: Type.String(),
          task: Type.String(),
        }),
        execute: async (_toolCallId, raw) => ({
          content: [
            {
              type: "text",
              text: JSON.stringify(
                await this.spawn({
                  profileId: readStringParam(raw, "profileId"),
                  task: readStringParam(raw, "task"),
                }),
                null,
                2,
              ),
            },
          ],
          details: {
            specialistCount: this.results.length,
          },
        }),
      },
      {
        name: "sessions_list",
        label: "Sessions List",
        description: "List specialists already spawned under this backtest day.",
        parameters: Type.Object({}),
        execute: async () => ({
          content: [{ type: "text", text: JSON.stringify(this.results, null, 2) }],
          details: this.results,
        }),
      },
      {
        name: "sessions_history",
        label: "Sessions History",
        description: "Read specialist results from this backtest day.",
        parameters: Type.Object({}),
        execute: async () => ({
          content: [{ type: "text", text: JSON.stringify(this.results, null, 2) }],
          details: this.results,
        }),
      },
    ];
  }

  private async spawn(params: { profileId: string; task: string }): Promise<SpecialistResult> {
    if (!SPAWNABLE_SPECIALISTS.has(params.profileId as never)) {
      throw new Error(`Backtest sessions cannot spawn '${params.profileId}'.`);
    }
    await this.params.trace?.log({
      type: "specialist_spawn_requested",
      data: {
        date: this.params.date,
        profileId: params.profileId,
        task: params.task,
      },
    });
    const sessionId = `${this.params.rootSessionId}:${params.profileId}:${this.results.length + 1}`;
    const contextSnapshots = await this.params.getContextSnapshots();
    const run = await runWithBacktestTransientRetry({
      operation: "backtest_specialist",
      sessionId,
      trace: this.params.trace,
      run: async () =>
        this.params.piRuntime.runEphemeral({
          sessionKey: sessionId,
          systemPrompt: await this.params.prompts.composeAgentPrompt(params.profileId as never),
          userPrompt: [
            `Original user request: ${this.params.dataset.rootUserMessage}`,
            "",
            `Backtest date: ${this.params.date}`,
            `Specialist task: ${params.task}`,
            "",
            "You are in a historical backtest. Use only the context below. Do not assume knowledge after this date, do not browse, and do not execute trades.",
            "",
            "Current portfolio snapshot:",
            JSON.stringify(this.params.portfolio, null, 2),
            "",
            "Visible historical data window:",
            JSON.stringify(this.params.window, null, 2),
            "",
            "Resolved historical context snapshots:",
            contextSnapshots.length > 0
              ? JSON.stringify(
                  contextSnapshots.map((snapshot) => ({
                    contextType: snapshot.request.contextType,
                    objective: snapshot.request.objective,
                    asOf: snapshot.asOf,
                    symbols: snapshot.symbols,
                    title: snapshot.title,
                    summary: snapshot.summary,
                    findings: snapshot.findings,
                    warnings: snapshot.warnings,
                  })),
                  null,
                  2,
                )
              : "(none)",
          ].join("\n"),
          customTools: [],
        }),
    });
    const result: SpecialistResult = {
      role: params.profileId,
      sessionId,
      message: run.message,
      toolCalls: run.toolCalls,
      usage: run.usage,
      requestId: this.params.requestId,
      task: params.task,
      createdAt: new Date().toISOString(),
    };
    this.results.push(result);
    await this.params.trace?.log({
      type: "specialist_completed",
      data: {
        date: this.params.date,
        profileId: params.profileId,
        sessionId,
        task: params.task,
        toolCalls: run.toolCalls,
        message: run.message,
      },
    });
    return result;
  }
}

function backtestRequestContextTool(params: {
  resolver: BacktestContextResolverService;
  runId: string;
  dataset: BacktestDataset;
  date: string;
  rootSessionId: string;
  rootUserMessage: string;
  getPortfolio(): PortfolioSnapshot;
  getWindow(): BacktestWindow;
  trace: BacktestTraceSink | null;
}): ToolDefinition {
  return {
    name: "backtest_request_context",
    label: "Backtest Request Context",
    description:
      "Resolve extra historical context for this backtest trading day. The returned snapshot is cached and must remain strictly earlier than the current trading date.",
    parameters: Type.Object({
      contextType: Type.String(),
      objective: Type.String(),
      symbols: Type.Optional(Type.Array(Type.String())),
      lookbackDays: Type.Optional(Type.Number()),
      maxItems: Type.Optional(Type.Number()),
    }),
    execute: async (_toolCallId, raw) => {
      const request = readContextRequest(raw);
      const snapshot = await params.resolver.resolveContext({
        runId: params.runId,
        currentDate: params.date,
        rootSessionId: params.rootSessionId,
        rootUserMessage: params.rootUserMessage,
        dataset: params.dataset,
        window: params.getWindow(),
        portfolioJson: JSON.stringify(params.getPortfolio(), null, 2),
        request,
        trace: params.trace,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(snapshot, null, 2) }],
        details: {
          contextType: snapshot.request.contextType,
          providerType: snapshot.providerType,
          providerName: snapshot.providerName,
          title: snapshot.title,
          asOf: snapshot.asOf,
        },
      };
    },
  };
}

function buildWindow(dataset: BacktestDataset, currentDate: string): BacktestWindow {
  const index = dataset.calendar.indexOf(currentDate);
  const priorDate = index > 0 ? dataset.calendar[index - 1] ?? null : null;
  const barsBySymbol = Object.fromEntries(
    Object.entries(dataset.barsBySymbol).map(([symbol, bars]) => [
      symbol,
      bars.filter((bar) => bar.date < currentDate).slice(-dataset.executionPolicy.maxLookbackBars),
    ]),
  );
  return {
    currentDate,
    priorDate,
    lookbackBars: dataset.executionPolicy.maxLookbackBars,
    barsBySymbol,
  };
}

function portfolioReadTool(getPortfolio: () => PortfolioSnapshot, trace: BacktestTraceSink | null, date: string): ToolDefinition {
  return {
    name: "portfolio_read",
    label: "Portfolio Read",
    description: "Read the current backtest portfolio snapshot as JSON.",
    parameters: Type.Object({}),
    execute: async () => {
      const portfolio = getPortfolio();
      await trace?.log({
        type: "tool_result",
        data: {
          date,
          tool: "portfolio_read",
          ok: true,
          result: {
            cash: portfolio.cash,
            equity: portfolio.equity,
            positions: portfolio.positions.map((position) => ({
              symbol: position.symbol,
              quantity: position.quantity,
            })),
          },
        },
      });
      return {
        content: [{ type: "text", text: JSON.stringify(portfolio, null, 2) }],
        details: portfolio,
      };
    },
  };
}

function portfolioSummaryTool(getPortfolio: () => PortfolioSnapshot, trace: BacktestTraceSink | null, date: string): ToolDefinition {
  return {
    name: "portfolio_summary",
    label: "Portfolio Summary",
    description: "Generate a markdown summary of the current backtest portfolio.",
    parameters: Type.Object({}),
    execute: async () => {
      const portfolio = getPortfolio();
      const summary = buildPortfolioSummary(portfolio);
      await trace?.log({
        type: "tool_result",
        data: {
          date,
          tool: "portfolio_summary",
          ok: true,
          result: compactText(summary, 400),
        },
      });
      return {
        content: [{ type: "text", text: summary }],
        details: portfolio,
      };
    },
  };
}

function paperTradeTool(
  side: "buy" | "sell",
  executeTrade: (trade: BacktestTradeIntent) => Promise<BacktestTradeExecutionResult>,
  trace: BacktestTraceSink | null,
  date: string,
): ToolDefinition {
  return {
    name: side === "buy" ? "paper_trade_buy" : "paper_trade_sell",
    label: side === "buy" ? "Paper Trade Buy" : "Paper Trade Sell",
    description:
      side === "buy"
        ? "Record a backtest buy. Execution is handled by the backtest engine, not the live paper portfolio."
        : "Record a backtest sell. Execution is handled by the backtest engine, not the live paper portfolio.",
    parameters: Type.Object({
      symbol: Type.String(),
      quantity: Type.Number(),
      rationale: Type.Optional(Type.String()),
    }),
    execute: async (_toolCallId, raw) => {
      const trade = {
        symbol: readStringParam(raw, "symbol"),
        side,
        quantity: readNumberParam(raw, "quantity"),
        rationale: readOptionalStringParam(raw, "rationale") || `backtest_${side}`,
      } satisfies BacktestTradeIntent;
      const result = await executeTrade(trade);
      await trace?.log({
        type: result.status === "filled" ? "trade_filled" : "trade_rejected",
        data: {
          date,
          tool: side === "buy" ? "paper_trade_buy" : "paper_trade_sell",
          request: trade,
          result,
        },
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: { side },
      };
    },
  };
}

function compactText(input: string, maxLength: number): string {
  const normalized = input.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function readStringParam(raw: unknown, key: string): string {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>)[key] : undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing required string parameter '${key}'.`);
  }
  return value.trim();
}

function readOptionalStringParam(raw: unknown, key: string): string | undefined {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>)[key] : undefined;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readContextRequest(raw: unknown): BacktestContextRequest {
  const object = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const symbols = Array.isArray(object.symbols)
    ? object.symbols
        .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
        .map((value) => value.trim())
    : [];
  return {
    contextType: readStringParam(raw, "contextType"),
    objective: readStringParam(raw, "objective"),
    symbols,
    lookbackDays: readOptionalNumberParam(raw, "lookbackDays") ?? 14,
    maxItems: readOptionalNumberParam(raw, "maxItems") ?? 8,
  };
}

function readNumberParam(raw: unknown, key: string): number {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>)[key] : undefined;
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error(`Invalid numeric parameter '${key}'.`);
  }
  return numeric;
}

function readOptionalNumberParam(raw: unknown, key: string): number | null {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>)[key] : undefined;
  if (value == null || value === "") {
    return null;
  }
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error(`Invalid numeric parameter '${key}'.`);
  }
  return numeric;
}
