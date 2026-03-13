import { randomUUID } from "node:crypto";

import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";

import { runMcporter } from "../mcporter/runner.js";
import type { McpListedTool } from "../mcp/runtime.js";
import type { PiRuntime } from "../pi/runtime.js";
import type { PromptRegistry } from "../prompts/registry.js";
import type { ToolCallRecord } from "../types.js";
import {
  hasExplicitDestructiveConfirmation,
  isDestructiveCommand,
  runLocalShellCommand,
  tokenizeCommand,
} from "../tools/support.js";
import type { BacktestTraceSink } from "./artifacts.js";
import { inferTradingCalendar } from "./calendar.js";
import { normalizeSymbol } from "./state.js";
import type {
  BacktestDataset,
  BacktestExecutionPolicy,
  BacktestHistoricalBar,
  BacktestProviderInfo,
} from "./types.js";
import { runWithBacktestTransientRetry } from "./runtime-retry.js";

interface BacktestPreparedCommit {
  provider: BacktestProviderInfo;
  barsBySymbol: Record<string, BacktestHistoricalBar[]>;
  calendar: string[];
  warnings: string[];
}

interface BacktestPreparedAccumulator {
  provider: BacktestProviderInfo | null;
  calendarHint: string[];
  warnings: string[];
  barsBySymbol: Record<string, BacktestHistoricalBar[]>;
}

export interface BacktestPreparedMarketData extends BacktestPreparedCommit {
  preparationSessionId: string;
  preparationMessage: string;
  preparationToolCalls: ToolCallRecord[];
}

export class BacktestDatasetPreparer {
  constructor(
    private readonly piRuntime: PiRuntime,
    private readonly prompts: PromptRegistry,
    private readonly availableMcpTools: () => McpListedTool[],
  ) {}

  async prepare(params: {
    kind: BacktestDataset["kind"];
    sessionId: string;
    rootUserMessage: string;
    dateFrom: string;
    dateTo: string;
    symbols: string[];
    executionPolicy: BacktestExecutionPolicy;
    trace?: BacktestTraceSink | null;
  }): Promise<BacktestPreparedMarketData> {
    const normalizedSymbols = [...new Set(params.symbols.map((symbol) => normalizeSymbol(symbol)))];
    const sessionId = `backtest-prepare:${params.sessionId}:${randomUUID()}`;
    const committed: { value: BacktestPreparedCommit | null } = { value: null };
    const safeMcpTools = filterSafePrepareMcpTools(this.availableMcpTools());
    await params.trace?.log({
      type: "prepare_started",
      data: {
        sessionId,
        kind: params.kind,
        dateFrom: params.dateFrom,
        dateTo: params.dateTo,
        symbols: normalizedSymbols,
        mcpTools: safeMcpTools.map((tool) => `${tool.server}/${tool.name}`),
      },
    });

    const run = await runWithBacktestTransientRetry({
      operation: "backtest_prepare_root",
      sessionId,
      trace: params.trace ?? null,
      run: async () =>
        this.piRuntime.runEphemeral({
          sessionKey: sessionId,
          systemPrompt: await this.buildSystemPrompt(),
          userPrompt: this.buildUserPrompt({
            ...params,
            symbols: normalizedSymbols,
            safeMcpTools,
          }),
          customTools: [
            createPrepareExecCommandTool(params.rootUserMessage, params.trace ?? null),
            createCommitPreparedDataTool({
              requestedSymbols: normalizedSymbols,
              dateFrom: params.dateFrom,
              dateTo: params.dateTo,
              trace: params.trace ?? null,
              commit(target) {
                committed.value = target;
              },
            }),
          ],
        }),
    });

    await params.trace?.log({
      type: "prepare_root_completed",
      data: {
        sessionId,
        message: run.message,
        toolCalls: run.toolCalls,
      },
    });

    if (!committed.value) {
      throw new Error(
        `Backtest preparation did not commit market data. Final root output: ${run.message || "(empty)"}`,
      );
    }

    return {
      ...committed.value,
      preparationSessionId: sessionId,
      preparationMessage: run.message,
      preparationToolCalls: run.toolCalls,
    };
  }

  private async buildSystemPrompt(): Promise<string> {
    const base = await this.prompts.composeAgentPrompt("orchestrator");
    const workflow = await this.prompts.composeWorkflowPrompt("backtest_prepare_mode");
    return [base, workflow].filter(Boolean).join("\n\n").trim();
  }

  private buildUserPrompt(params: {
    kind: BacktestDataset["kind"];
    rootUserMessage: string;
    dateFrom: string;
    dateTo: string;
    symbols: string[];
    executionPolicy: BacktestExecutionPolicy;
    safeMcpTools: McpListedTool[];
  }): string {
    const mcpLines = params.safeMcpTools.length > 0
      ? params.safeMcpTools
          .map((tool) => `- ${tool.server}.${tool.name}${tool.description ? `: ${tool.description}` : ""}`)
          .join("\n")
      : "- (none exposed through mcporter discovery)";

    return [
      `Original user request: ${params.rootUserMessage}`,
      "",
      "Your task is to prepare a frozen historical market dataset for a later backtest run.",
      "Do not answer with prose only. You must call backtest_commit_prepared_data once you have valid daily OHLC bars.",
      "",
      `Backtest kind: ${params.kind}`,
      `Requested symbols: ${params.symbols.join(", ")}`,
      `Date window: ${params.dateFrom} to ${params.dateTo}`,
      `Execution policy: buy=${params.executionPolicy.buyPrice}, sell=${params.executionPolicy.sellPrice}, feesBps=${params.executionPolicy.feesBps}, slippageBps=${params.executionPolicy.slippageBps}`,
      "",
      "Preferred discovery workflow:",
      "1. Inspect the active workflow guidance and available skills before defaulting to generic MCP discovery.",
      "2. If a non-mcporter skill clearly matches and exposes an executable local script or CLI, run that skill workflow first.",
      "3. Use mcporter when it is the best fit or when the chosen skill routes through MCP.",
      "4. Use exec_command for read-only discovery and execution of the chosen workflow.",
      "5. If the direct history tool omits explicit dates, fetch trading dates separately and align them before commit.",
      "6. Prefer one complete commit that covers every requested symbol. If you must commit in batches, each batch must still contain validated daily bars and use the same provider.",
      "7. Only commit validated daily bars. Never estimate, interpolate, or fabricate prices.",
      "",
      "Example command patterns:",
      "- mcporter list --output json",
      "- mcporter list <server> --schema --output json",
      "- mcporter call <server.tool> --output json --json '{\"code\":\"AAPL.US\",\"start_date\":\"2026-01-02\",\"end_date\":\"2026-01-08\",\"frequency\":\"1d\"}'",
      "- uv run <skill-script> ...",
      "",
      "Visible safe MCP tools discovered for this run:",
      mcpLines,
      "",
      "Commit contract:",
      "- Prefer one final backtest_commit_prepared_data call containing all requested symbols.",
      "- If the payload is too large, you may commit in multiple calls with symbol subsets; stock-claw will merge them until all requested symbols are present.",
      "- Include provider metadata and calendar in at least one commit call.",
      "- provider.server: the source family you ended up using",
      "- provider.historyTool: the concrete bar-fetch mechanism you used",
      "- provider.tradeDatesTool: the concrete trade-date mechanism you used, or null",
      "- barsBySymbol: one daily OHLC series per requested symbol",
      "- calendar: the final trading dates you believe are valid for this dataset",
      "- warnings: optional warnings about missing fields or alignment assumptions",
    ].join("\n");
  }
}

function createPrepareExecCommandTool(
  rootUserMessage: string,
  trace: BacktestTraceSink | null,
): ToolDefinition {
  return {
    name: "exec_command",
    label: "Exec Command",
    description:
      "Run a local shell command. Prefer mcporter for MCP discovery and MCP tool calls. Destructive commands are blocked without explicit user confirmation.",
    parameters: Type.Object({
      command: Type.String(),
      cwd: Type.Optional(Type.String()),
      timeoutMs: Type.Optional(Type.Number()),
    }),
    execute: async (_toolCallId, params) => {
      const raw = normalizeObject(params);
      const command = requiredTrimmedString(raw.command, "command");
      if (isDestructiveCommand(command) && !hasExplicitDestructiveConfirmation(rootUserMessage)) {
        throw new Error(
          "Destructive delete/remove commands require explicit user confirmation in the current turn.",
        );
      }
      const timeoutMs = finiteOptionalNumber(raw.timeoutMs) ?? 120_000;
      const cwd = typeof raw.cwd === "string" && raw.cwd.trim() ? raw.cwd.trim() : undefined;
      const tokens = tokenizeCommand(command);
      const result = tokens[0] === "mcporter"
        ? await runMcporter(tokens.slice(1), process.env)
        : await runLocalShellCommand(command, { cwd, timeoutMs });

      const stdout = "stdout" in result ? result.stdout : "";
      const stderr = "stderr" in result ? result.stderr : "";
      const exitCode = typeof result.exitCode === "number" || result.exitCode === null ? result.exitCode : 0;
      const output = [stdout, stderr].filter(Boolean).join("\n").trim() || "(no output)";

      await trace?.log({
        type: "prepare_tool_result",
        data: {
          tool: "exec_command",
          command,
          exitCode,
          ok: exitCode === 0 || exitCode === null,
          result: compactText(output, 1600),
        },
      });

      return {
        content: [{ type: "text", text: output }],
        details: {
          command,
          cwd: cwd ?? null,
          exitCode,
          mode: tokens[0] === "mcporter" ? "mcporter" : "shell",
        },
      };
    },
  };
}

function createCommitPreparedDataTool(params: {
  requestedSymbols: string[];
  dateFrom: string;
  dateTo: string;
  trace: BacktestTraceSink | null;
  commit(target: BacktestPreparedCommit): void;
}): ToolDefinition {
  let committedSnapshot: BacktestPreparedCommit | null = null;
  let accumulated: BacktestPreparedAccumulator = {
    provider: null,
    calendarHint: [],
    warnings: [],
    barsBySymbol: {},
  };
  return {
    name: "backtest_commit_prepared_data",
    label: "Backtest Commit Prepared Data",
    description:
      "Commit a validated historical dataset candidate for the backtest. Call this exactly once after you have fetched and aligned daily bars.",
    parameters: Type.Object({
      provider: Type.Optional(
        Type.Object({
          server: Type.String(),
          historyTool: Type.String(),
          tradeDatesTool: Type.Optional(Type.Union([Type.String(), Type.Null()])),
          frequency: Type.Optional(Type.String()),
          adjustFlag: Type.Optional(Type.String()),
          format: Type.Optional(Type.String()),
          selectedAt: Type.Optional(Type.String()),
          sourceSummary: Type.Optional(Type.String()),
          toolchain: Type.Optional(Type.Array(Type.String())),
        }),
      ),
      calendar: Type.Optional(Type.Array(Type.String())),
      warnings: Type.Optional(Type.Array(Type.String())),
      barsBySymbol: Type.Record(
        Type.String(),
        Type.Array(
          Type.Object({
            date: Type.String(),
            open: Type.Number(),
            high: Type.Number(),
            low: Type.Number(),
            close: Type.Number(),
            volume: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
            turnover: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
            rawTime: Type.Optional(Type.Union([Type.String(), Type.Null()])),
          }),
        ),
      ),
    }),
    execute: async (_toolCallId, raw) => {
      if (committedSnapshot) {
        await params.trace?.log({
          level: "warn",
          type: "prepare_dataset_commit_ignored",
          data: {
            provider: committedSnapshot.provider,
            symbols: params.requestedSymbols,
          },
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ok: true,
                  alreadyCommitted: true,
                  provider: committedSnapshot.provider,
                  tradingDays: committedSnapshot.calendar.length,
                  symbols: params.requestedSymbols,
                },
                null,
                2,
              ),
            },
          ],
          details: {
            alreadyCommitted: true,
            provider: committedSnapshot.provider,
            tradingDays: committedSnapshot.calendar.length,
          },
        };
      }
      const merged = mergePreparedCommitChunk({
        raw,
        accumulator: accumulated,
        requestedSymbols: params.requestedSymbols,
        dateFrom: params.dateFrom,
        dateTo: params.dateTo,
      });
      accumulated = merged.accumulator;
      if (!merged.committed) {
        await params.trace?.log({
          type: "prepare_dataset_partial",
          data: {
            acceptedSymbols: merged.acceptedSymbols,
            pendingSymbols: merged.pendingSymbols,
            hasProvider: Boolean(accumulated.provider),
            calendarHintCount: accumulated.calendarHint.length,
          },
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ok: true,
                  partial: true,
                  acceptedSymbols: merged.acceptedSymbols,
                  pendingSymbols: merged.pendingSymbols,
                  awaitingProvider: !accumulated.provider,
                },
                null,
                2,
              ),
            },
          ],
          details: {
            partial: true,
            acceptedSymbols: merged.acceptedSymbols,
            pendingSymbols: merged.pendingSymbols,
            awaitingProvider: !accumulated.provider,
          },
        };
      }
      committedSnapshot = merged.committed;
      params.commit(merged.committed);
      await params.trace?.log({
        type: "prepare_dataset_committed",
        data: {
          provider: merged.committed.provider,
          symbols: params.requestedSymbols,
          tradingDays: merged.committed.calendar.length,
          warnings: merged.committed.warnings,
        },
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ok: true,
                provider: merged.committed.provider,
                tradingDays: merged.committed.calendar.length,
                symbols: params.requestedSymbols,
              },
              null,
              2,
            ),
          },
        ],
        details: {
          provider: merged.committed.provider,
          tradingDays: merged.committed.calendar.length,
        },
      };
    },
  };
}

function mergePreparedCommitChunk(params: {
  raw: unknown;
  accumulator: BacktestPreparedAccumulator;
  requestedSymbols: string[];
  dateFrom: string;
  dateTo: string;
}): {
  accumulator: BacktestPreparedAccumulator;
  committed: BacktestPreparedCommit | null;
  acceptedSymbols: string[];
  pendingSymbols: string[];
} {
  const input = normalizeObject(params.raw);
  const barsInput = normalizeObject(input.barsBySymbol);
  const rawWarnings = Array.isArray(input.warnings)
    ? input.warnings.filter((value): value is string => typeof value === "string" && Boolean(value.trim())).map((value) => value.trim())
    : [];

  const acceptedSymbols: string[] = [];
  const nextBarsBySymbol: Record<string, BacktestHistoricalBar[]> = {
    ...params.accumulator.barsBySymbol,
  };
  for (const sourceKey of Object.keys(barsInput)) {
    const symbol = resolveRequestedSymbol(sourceKey, params.requestedSymbols);
    if (!symbol) {
      continue;
    }
    const rows = Array.isArray(barsInput[sourceKey]) ? (barsInput[sourceKey] as unknown[]) : [];
    const normalized = normalizeBars(rows, params.dateFrom, params.dateTo);
    if (normalized.length === 0) {
      throw new Error(`Prepared dataset chunk is missing valid daily bars for ${symbol}.`);
    }
    nextBarsBySymbol[symbol] = normalized;
    acceptedSymbols.push(symbol);
  }

  const committedCalendar = Array.isArray(input.calendar)
    ? input.calendar
        .filter((value): value is string => typeof value === "string")
        .map((value) => normalizeDateString(value))
        .filter((value): value is string => Boolean(value))
    : [];
  const nextAccumulator: BacktestPreparedAccumulator = {
    provider: mergeProviderInfo(
      params.accumulator.provider,
      input.provider == null ? null : normalizeProviderInfo(input.provider),
    ),
    calendarHint: committedCalendar.length > 0 ? committedCalendar : params.accumulator.calendarHint,
    warnings: dedupeStrings([...params.accumulator.warnings, ...rawWarnings]),
    barsBySymbol: nextBarsBySymbol,
  };
  const pendingSymbols = params.requestedSymbols.filter((symbol) => !nextAccumulator.barsBySymbol[symbol]);
  if (!nextAccumulator.provider || pendingSymbols.length > 0) {
    return {
      accumulator: nextAccumulator,
      committed: null,
      acceptedSymbols,
      pendingSymbols,
    };
  }

  return {
    accumulator: nextAccumulator,
    committed: finalizePreparedCommit({
      accumulator: nextAccumulator,
      requestedSymbols: params.requestedSymbols,
    }),
    acceptedSymbols,
    pendingSymbols: [],
  };
}

function finalizePreparedCommit(params: {
  accumulator: BacktestPreparedAccumulator;
  requestedSymbols: string[];
}): BacktestPreparedCommit {
  const normalizedBarsBySymbol: Record<string, BacktestHistoricalBar[]> = {};
  for (const symbol of params.requestedSymbols) {
    const bars = params.accumulator.barsBySymbol[symbol];
    if (!bars || bars.length === 0) {
      throw new Error(`Prepared dataset is missing valid daily bars for ${symbol}.`);
    }
    normalizedBarsBySymbol[symbol] = bars;
  }

  const derivedCalendar = inferTradingCalendar(normalizedBarsBySymbol);
  if (derivedCalendar.length === 0) {
    throw new Error("Prepared dataset did not yield any valid trading dates.");
  }

  const warnings = [...params.accumulator.warnings];
  if (params.accumulator.calendarHint.length > 0 && !sameDateArray(params.accumulator.calendarHint, derivedCalendar)) {
    warnings.push(
      "Committed calendar differed from the bar-derived trading calendar; stock-claw used the bar-derived dates instead.",
    );
  }

  return {
    provider: params.accumulator.provider!,
    barsBySymbol: normalizedBarsBySymbol,
    calendar: derivedCalendar,
    warnings: aggregatePreparationWarnings(params.accumulator.provider!, warnings),
  };
}

function normalizeProviderInfo(raw: unknown): BacktestProviderInfo {
  const input = normalizeObject(raw);
  const selectedAt = normalizeIsoDate(typeof input.selectedAt === "string" ? input.selectedAt : null) ?? new Date().toISOString();
  const toolchain = Array.isArray(input.toolchain)
    ? input.toolchain.filter((value): value is string => typeof value === "string" && Boolean(value.trim())).map((value) => value.trim())
    : [];

  return {
    server: requiredTrimmedString(input.server, "provider.server"),
    historyTool: requiredTrimmedString(input.historyTool, "provider.historyTool"),
    tradeDatesTool:
      input.tradeDatesTool == null
        ? null
        : requiredTrimmedString(input.tradeDatesTool, "provider.tradeDatesTool"),
    frequency: typeof input.frequency === "string" && input.frequency.trim() ? input.frequency.trim() : "1d",
    adjustFlag: typeof input.adjustFlag === "string" && input.adjustFlag.trim() ? input.adjustFlag.trim() : "0",
    format: typeof input.format === "string" && input.format.trim() ? input.format.trim() : "json",
    selectedAt,
    ...(typeof input.sourceSummary === "string" && input.sourceSummary.trim()
      ? { sourceSummary: input.sourceSummary.trim() }
      : {}),
    ...(toolchain.length > 0 ? { toolchain } : {}),
  };
}

function normalizeBars(rows: unknown[], dateFrom: string, dateTo: string): BacktestHistoricalBar[] {
  const deduped = new Map<string, BacktestHistoricalBar>();
  for (const row of rows) {
    const record = normalizeObject(row);
    const date = normalizeDateString(typeof record.date === "string" ? record.date : null);
    if (!date || date < dateFrom || date > dateTo) {
      continue;
    }
    const open = finiteRequiredNumber(record.open, "open");
    const high = finiteRequiredNumber(record.high, "high");
    const low = finiteRequiredNumber(record.low, "low");
    const close = finiteRequiredNumber(record.close, "close");
    deduped.set(date, {
      date,
      open,
      high,
      low,
      close,
      volume: finiteNullableNumber(record.volume),
      turnover: finiteNullableNumber(record.turnover),
      rawTime: typeof record.rawTime === "string" && record.rawTime.trim() ? record.rawTime.trim() : null,
    });
  }
  return [...deduped.values()].sort((left, right) => left.date.localeCompare(right.date));
}

function resolveRequestedSymbol(sourceKey: string, requestedSymbols: string[]): string | null {
  if (requestedSymbols.includes(sourceKey)) {
    return sourceKey;
  }
  const normalizedRequested = normalizeSymbol(sourceKey);
  for (const symbol of requestedSymbols) {
    if (normalizeSymbol(symbol) === normalizedRequested) {
      return symbol;
    }
  }
  return null;
}

function mergeProviderInfo(
  current: BacktestProviderInfo | null,
  incoming: BacktestProviderInfo | null,
): BacktestProviderInfo | null {
  if (!incoming) {
    return current;
  }
  if (!current) {
    return incoming;
  }
  if (
    current.server !== incoming.server ||
    current.historyTool !== incoming.historyTool ||
    current.tradeDatesTool !== incoming.tradeDatesTool
  ) {
    throw new Error(
      `Prepared dataset provider changed mid-commit from ${current.server}/${current.historyTool} to ${incoming.server}/${incoming.historyTool}.`,
    );
  }
  return {
    ...current,
    ...incoming,
    toolchain: dedupeStrings([...(current.toolchain ?? []), ...(incoming.toolchain ?? [])]),
    sourceSummary: incoming.sourceSummary ?? current.sourceSummary,
  };
}

function filterSafePrepareMcpTools(tools: McpListedTool[]): McpListedTool[] {
  return tools.filter((tool) => {
    const haystack = `${tool.name} ${tool.description ?? ""}`.toLowerCase();
    return !/\b(create|update|delete|remove|write|append|patch|post|send|publish|install|restart|approve|submit|place|buy|sell|order)\b/.test(haystack);
  });
}

function normalizeObject(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
}

function normalizeDateString(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const match = value.match(/\d{4}-\d{2}-\d{2}/);
  return match?.[0] ?? null;
}

function normalizeIsoDate(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function sameDateArray(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function requiredTrimmedString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing required string field '${label}'.`);
  }
  return value.trim();
}

function finiteRequiredNumber(value: unknown, label: string): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`Invalid numeric field '${label}'.`);
  }
  return numeric;
}

function finiteNullableNumber(value: unknown): number | null {
  if (value == null || value === "") {
    return null;
  }
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function finiteOptionalNumber(value: unknown): number | null {
  if (value == null || value === "") {
    return null;
  }
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim()))];
}

function aggregatePreparationWarnings(provider: BacktestProviderInfo, warnings: string[]): string[] {
  const remaining: string[] = [];
  const missingDateSymbols: string[] = [];
  const missingDatePattern =
    /^Historical bars for (?<symbol>.+?) did not include explicit dates; dates were aligned from provider trade_dates output\.$/;

  for (const warning of dedupeStrings(warnings)) {
    const match = warning.match(missingDatePattern);
    const symbol = match?.groups?.symbol?.trim();
    if (symbol) {
      missingDateSymbols.push(symbol);
      continue;
    }
    remaining.push(warning);
  }

  if (missingDateSymbols.length > 0) {
    remaining.unshift(
      `Historical bars from ${provider.server}/${provider.historyTool} did not include explicit date fields for ${missingDateSymbols.length} symbol(s): ${missingDateSymbols.join(", ")}. Dates were aligned using ${provider.tradeDatesTool ?? "provider trade_dates"}.`,
    );
  }

  return remaining;
}

function compactText(input: string, maxLength: number): string {
  const normalized = input.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}
