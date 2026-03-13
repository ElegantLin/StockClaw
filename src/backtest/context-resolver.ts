import { randomUUID } from "node:crypto";

import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";

import { runMcporter } from "../mcporter/runner.js";
import type { McpListedTool } from "../mcp/runtime.js";
import type { PiRuntime } from "../pi/runtime.js";
import type { PromptRegistry } from "../prompts/registry.js";
import type { BacktestStore } from "../state/backtest-store.js";
import {
  hasExplicitDestructiveConfirmation,
  isDestructiveCommand,
  runLocalShellCommand,
  tokenizeCommand,
} from "../tools/support.js";
import type { ToolCallRecord } from "../types.js";
import type { BacktestTraceSink } from "./artifacts.js";
import { normalizeSymbol } from "./state.js";
import { runWithBacktestTransientRetry } from "./runtime-retry.js";
import type { BacktestContextRequest, BacktestContextSnapshot, BacktestDataset, BacktestWindow } from "./types.js";

interface BacktestContextCommitPayload {
  asOf: string;
  providerType: string;
  providerName: string;
  toolName: string;
  title: string;
  summary: string;
  findings: string[];
  rawEvidence: string[];
  payloadJson: string | null;
  warnings: string[];
  symbols: string[];
}

interface CapturedContextCommandResult {
  command: string;
  output: string;
  exitCode: number | null;
  mode: "mcporter" | "shell";
}

export interface BacktestContextResolveParams {
  runId: string;
  currentDate: string;
  rootSessionId: string;
  rootUserMessage: string;
  dataset: BacktestDataset;
  window: BacktestWindow;
  portfolioJson: string;
  request: BacktestContextRequest;
  trace?: BacktestTraceSink | null;
}

export class BacktestContextResolverService {
  constructor(
    private readonly store: BacktestStore,
    private readonly piRuntime: PiRuntime,
    private readonly prompts: PromptRegistry,
    private readonly availableMcpTools: () => McpListedTool[],
  ) {}

  async resolveContext(params: BacktestContextResolveParams): Promise<BacktestContextSnapshot> {
    const request = normalizeRequest(params.request, params.dataset.symbols);
    const cacheKey = buildCacheKey(request);
    const cached = await this.findCachedSnapshot(params.runId, params.currentDate, cacheKey);
    if (cached) {
      await params.trace?.log({
        type: "context_cache_hit",
        data: {
          date: params.currentDate,
          cacheKey,
          request,
          resolutionSessionId: cached.resolutionSessionId,
        },
      });
      return cached;
    }

    const sessionId = `${params.rootSessionId}:context:${randomUUID()}`;
    const committed: { value: BacktestContextCommitPayload | null } = { value: null };
    const capturedResults: CapturedContextCommandResult[] = [];
    const safeMcpTools = filterSafeContextMcpTools(this.availableMcpTools());
    await params.trace?.log({
      type: "context_request_started",
      data: {
        date: params.currentDate,
        sessionId,
        cacheKey,
        request,
        mcpTools: safeMcpTools.map((tool) => `${tool.server}/${tool.name}`),
      },
    });

    const run = await runWithBacktestTransientRetry({
      operation: "backtest_context_root",
      sessionId,
      trace: params.trace ?? null,
      run: async () =>
        this.piRuntime.runEphemeral({
          sessionKey: sessionId,
          systemPrompt: await this.buildSystemPrompt(),
          userPrompt: this.buildUserPrompt({
            rootUserMessage: params.rootUserMessage,
            currentDate: params.currentDate,
            request,
            safeMcpTools,
            window: params.window,
            portfolioJson: params.portfolioJson,
          }),
          customTools: [
            createContextExecCommandTool(
              params.rootUserMessage,
              params.trace ?? null,
              params.currentDate,
              (result) => {
                capturedResults.push(result);
              },
            ),
            createCommitContextTool({
              currentDate: params.currentDate,
              request,
              commit(value) {
                committed.value = value;
              },
            }),
          ],
        }),
    });

    await params.trace?.log({
      type: "context_root_completed",
      data: {
        date: params.currentDate,
        sessionId,
        message: run.message,
        toolCalls: run.toolCalls,
      },
    });

    if (!committed.value) {
      const formatted = await this.tryFormatCommittedContext({
        committed,
        capturedResults,
        currentDate: params.currentDate,
        request,
        rootUserMessage: params.rootUserMessage,
        rootSessionId: sessionId,
        trace: params.trace ?? null,
      });
      if (formatted) {
        committed.value = formatted;
      }
    }

    if (!committed.value) {
      throw new Error(
        `Backtest context resolution did not commit context data. Final root output: ${run.message || "(empty)"}`,
      );
    }

    const snapshot: BacktestContextSnapshot = {
      cacheKey,
      date: params.currentDate,
      request,
      ...committed.value,
      resolutionSessionId: sessionId,
      resolutionMessage: run.message,
      resolutionToolCalls: run.toolCalls,
      createdAt: new Date().toISOString(),
    };
    await this.store.updateRun(params.runId, (current) => ({
      ...current,
      contextSnapshots: mergeContextSnapshots(current.contextSnapshots ?? [], snapshot),
    }));
    await params.trace?.log({
      type: "context_cached",
      data: {
        date: params.currentDate,
        cacheKey,
        request,
        snapshot: {
          asOf: snapshot.asOf,
          providerType: snapshot.providerType,
          providerName: snapshot.providerName,
          toolName: snapshot.toolName,
          title: snapshot.title,
          warnings: snapshot.warnings,
        },
      },
    });
    return snapshot;
  }

  async listDayContexts(runId: string, currentDate: string): Promise<BacktestContextSnapshot[]> {
    const run = await this.store.getRun(runId);
    if (!run) {
      return [];
    }
    return (run.contextSnapshots ?? [])
      .filter((snapshot) => snapshot.date === currentDate)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  private async findCachedSnapshot(
    runId: string,
    currentDate: string,
    cacheKey: string,
  ): Promise<BacktestContextSnapshot | null> {
    const run = await this.store.getRun(runId);
    if (!run) {
      throw new Error(`Unknown backtest run '${runId}'.`);
    }
    return (
      (run.contextSnapshots ?? []).find(
        (snapshot) => snapshot.date === currentDate && snapshot.cacheKey === cacheKey,
      ) ?? null
    );
  }

  private async buildSystemPrompt(): Promise<string> {
    const base = await this.prompts.composeAgentPrompt("orchestrator");
    const workflow = await this.prompts.composeWorkflowPrompt("backtest_context_resolution_mode");
    return [base, workflow].filter(Boolean).join("\n\n").trim();
  }

  private buildUserPrompt(params: {
    rootUserMessage: string;
    currentDate: string;
    request: BacktestContextRequest;
    safeMcpTools: McpListedTool[];
    window: BacktestWindow;
    portfolioJson: string;
  }): string {
    const mcpLines = params.safeMcpTools.length > 0
      ? params.safeMcpTools
          .map((tool) => `- ${tool.server}.${tool.name}${tool.description ? `: ${tool.description}` : ""}`)
          .join("\n")
      : "- (none exposed through mcporter discovery)";
    return [
      `Original user request: ${params.rootUserMessage}`,
      "",
      "You are resolving extra historical context for one backtest trading day.",
      "You must use discoverable external tools or skill-guided tool workflows, then commit one historical context snapshot.",
      "Do not answer with prose only. You must call backtest_commit_context exactly once.",
      "A matching skill is only executable if it exposes a concrete local script, binary, or command workflow you can actually run in this session.",
      "If a skill only provides documentation and no executable path, treat it as guidance only and move on.",
      "Do not use tools or scripts that emit current-day recommendations, current timestamps, or live market context unless you can independently prove every committed fact is historical and strictly earlier than the current trading date.",
      "Once you obtain one valid historical source for the requested context, commit immediately and stop exploring additional paths.",
      "",
      `Current trading date: ${params.currentDate}`,
      "All committed evidence must be strictly earlier than the current trading date.",
      "",
      `Requested context type: ${params.request.contextType}`,
      `Objective: ${params.request.objective}`,
      `Requested symbols: ${params.request.symbols.join(", ") || "(none)"}`,
      `Lookback days: ${params.request.lookbackDays}`,
      `Max items: ${params.request.maxItems}`,
      "",
      "Current portfolio snapshot:",
      params.portfolioJson,
      "",
      "Visible frozen price window (up to the prior trading day only):",
      JSON.stringify(params.window, null, 2),
      "",
      "Preferred workflow:",
      "1. Check the active workflow guidance and available skills before defaulting to generic MCP discovery.",
      "2. If a non-mcporter skill clearly matches and exposes an executable local script or CLI, run that skill workflow first.",
      "3. If no matching executable skill exists, you may assemble a short one-off read-only script or command that fetches raw historical data.",
      "4. Use mcporter when it is the best fit or when the chosen skill routes through MCP.",
      "5. Use exec_command for read-only discovery and execution such as mcporter or local skill scripts.",
      "6. Fetch only historical context that can be justified as of a date earlier than the current trading date.",
      "7. For price-history or technical-setup requests, prefer raw OHLC bars, dated technical indicators, or dated articles over generic recommendation summaries.",
      "8. Summarize the result in short factual findings and commit one structured snapshot.",
      "9. If you cannot establish a valid historical as-of date earlier than the current trading date, do not commit invented data.",
      "",
      "Example command patterns:",
      "- mcporter list --output json",
      "- mcporter list <server> --schema --output json",
      "- mcporter call <server.tool> --output json --json '{...}'",
      "- uv run <skill-script> ...",
      "- powershell here-string or python -c snippets are acceptable when you need a short read-only historical fetch command",
      "",
      "Visible safe MCP tools discovered for this run:",
      mcpLines,
      "",
      "Commit contract:",
      "- asOf: ISO timestamp or date for the historical context, strictly earlier than the current trading date",
      "- providerType: source family such as mcp or skill",
      "- providerName: concrete provider, server, or skill name",
      "- toolName: concrete external tool, command, or script name",
      "- title: short label for this context snapshot",
      "- summary: concise human-readable summary for the root agent",
      "- findings: short factual bullet-style findings",
      "- rawEvidence: short supporting excerpts or notes",
      "- payloadJson: optional compact JSON string if structured payload is useful",
      "- warnings: optional factual caveats",
      "- symbols: the symbol scope actually covered by this snapshot",
      "",
      "Historical acceptance rules:",
      "- The committed asOf must be strictly earlier than the current trading date.",
      "- Do not commit data that includes a current or future timestamp relative to the trading date.",
      "- Do not commit a live recommendation script output as historical context unless the script explicitly supports historical as-of inputs and you used them.",
    ].join("\n");
  }

  private async tryFormatCommittedContext(params: {
    committed: { value: BacktestContextCommitPayload | null };
    capturedResults: CapturedContextCommandResult[];
    currentDate: string;
    request: BacktestContextRequest;
    rootUserMessage: string;
    rootSessionId: string;
    trace: BacktestTraceSink | null;
  }): Promise<BacktestContextCommitPayload | null> {
    const usableResults = params.capturedResults
      .filter((result) => result.exitCode === 0 && Boolean(result.output.trim()))
      .slice(-6);
    if (usableResults.length === 0) {
      return null;
    }

    const sessionId = `${params.rootSessionId}:formatter`;
    await params.trace?.log({
      type: "context_formatter_started",
      data: {
        date: params.currentDate,
        sessionId,
        resultCount: usableResults.length,
      },
    });
    const run = await runWithBacktestTransientRetry({
      operation: "backtest_context_formatter",
      sessionId,
      trace: params.trace,
      run: async () =>
        this.piRuntime.runEphemeral({
          sessionKey: sessionId,
          systemPrompt: await this.buildSystemPrompt(),
          userPrompt: this.buildFormatterUserPrompt({
            rootUserMessage: params.rootUserMessage,
            currentDate: params.currentDate,
            request: params.request,
            capturedResults: usableResults,
          }),
          customTools: [
            createCommitContextTool({
              currentDate: params.currentDate,
              request: params.request,
              commit(value) {
                params.committed.value = value;
              },
            }),
          ],
        }),
    });
    await params.trace?.log({
      type: "context_formatter_completed",
      data: {
        date: params.currentDate,
        sessionId,
        message: run.message,
        toolCalls: run.toolCalls,
        committed: Boolean(params.committed.value),
      },
    });
    return params.committed.value;
  }

  private buildFormatterUserPrompt(params: {
    rootUserMessage: string;
    currentDate: string;
    request: BacktestContextRequest;
    capturedResults: CapturedContextCommandResult[];
  }): string {
    const captured = params.capturedResults
      .map((result, index) =>
        [
          `Result ${index + 1}:`,
          `- command: ${result.command}`,
          `- mode: ${result.mode}`,
          `- exitCode: ${result.exitCode ?? "null"}`,
          "- output:",
          compactText(result.output, 8000),
        ].join("\n"),
      )
      .join("\n\n");
    return [
      `Original user request: ${params.rootUserMessage}`,
      "",
      "A prior discovery phase already ran the external commands below.",
      "Do not run any more commands. Your only job is to convert one valid historical result into the backtest_commit_context schema.",
      `Current trading date: ${params.currentDate}`,
      `Requested context type: ${params.request.contextType}`,
      `Objective: ${params.request.objective}`,
      `Requested symbols: ${params.request.symbols.join(", ") || "(none)"}`,
      "",
      "Rules:",
      "- Commit exactly once if and only if one of the captured outputs contains valid historical information.",
      "- The committed asOf must be strictly earlier than the current trading date.",
      "- Ignore outputs that only contain live recommendations, current timestamps, or current market context.",
      "- Prefer the newest valid historical result among the captured outputs.",
      "- If none of the captured outputs are valid historical context, do not commit.",
      "",
      "Captured command outputs:",
      captured,
    ].join("\n");
  }
}

function createContextExecCommandTool(
  rootUserMessage: string,
  trace: BacktestTraceSink | null,
  currentDate: string,
  onResult: (result: CapturedContextCommandResult) => void,
): ToolDefinition {
  return {
    name: "exec_command",
    label: "Exec Command",
    description:
      "Run a read-only local shell command for historical backtest context discovery via mcporter or local skill scripts.",
    parameters: Type.Object({
      command: Type.String(),
      cwd: Type.Optional(Type.String()),
      timeoutMs: Type.Optional(Type.Number()),
    }),
    execute: async (_toolCallId, params) => {
      const raw = normalizeObject(params);
      const command = requiredTrimmedString(raw.command, "command");
      if (isDestructiveCommand(command) && !hasExplicitDestructiveConfirmation(rootUserMessage)) {
        throw new Error("Destructive delete/remove commands require explicit user confirmation in the current turn.");
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
        type: "context_tool_result",
        data: {
          date: currentDate,
          tool: "exec_command",
          command,
          exitCode,
          ok: exitCode === 0 || exitCode === null,
          result: compactText(output, 1600),
        },
      });
      onResult({
        command,
        output,
        exitCode,
        mode: tokens[0] === "mcporter" ? "mcporter" : "shell",
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

function createCommitContextTool(params: {
  currentDate: string;
  request: BacktestContextRequest;
  commit(value: BacktestContextCommitPayload): void;
}): ToolDefinition {
  let committed: BacktestContextCommitPayload | null = null;
  return {
    name: "backtest_commit_context",
    label: "Backtest Commit Context",
    description: "Commit one structured historical context snapshot for the current backtest day.",
    parameters: Type.Object({
      asOf: Type.String(),
      providerType: Type.String(),
      providerName: Type.String(),
      toolName: Type.String(),
      title: Type.String(),
      summary: Type.String(),
      findings: Type.Array(Type.String()),
      rawEvidence: Type.Array(Type.String()),
      payloadJson: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      warnings: Type.Optional(Type.Array(Type.String())),
      symbols: Type.Optional(Type.Array(Type.String())),
    }),
    execute: async (_toolCallId, input) => {
      if (committed) {
        return {
          content: [{ type: "text", text: JSON.stringify(committed, null, 2) }],
          details: committed,
        };
      }
      const payload = normalizeCommitPayload(normalizeObject(input), params.currentDate, params.request);
      committed = payload;
      params.commit(payload);
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        details: payload,
      };
    },
  };
}

function normalizeCommitPayload(
  input: Record<string, unknown>,
  currentDate: string,
  request: BacktestContextRequest,
): BacktestContextCommitPayload {
  const asOf = normalizeHistoricalAsOf(requiredTrimmedString(input.asOf, "asOf"), currentDate);
  const payloadJson = normalizePayloadJson(input.payloadJson);
  const symbols = Array.isArray(input.symbols)
    ? dedupeStrings(
        input.symbols
          .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
          .map((value) => normalizeSymbol(value)),
      )
    : [...request.symbols];

  return {
    asOf,
    providerType: requiredTrimmedString(input.providerType, "providerType"),
    providerName: requiredTrimmedString(input.providerName, "providerName"),
    toolName: requiredTrimmedString(input.toolName, "toolName"),
    title: compactText(requiredTrimmedString(input.title, "title"), 200),
    summary: compactText(requiredTrimmedString(input.summary, "summary"), 4000),
    findings: normalizeStringArray(input.findings, "findings", 20, 240),
    rawEvidence: normalizeStringArray(input.rawEvidence, "rawEvidence", 12, 500),
    payloadJson,
    warnings: normalizeOptionalStringArray(input.warnings, 12, 240),
    symbols,
  };
}

function normalizeRequest(
  request: BacktestContextRequest,
  defaultSymbols: string[],
): BacktestContextRequest {
  const contextType = request.contextType.trim() ? request.contextType.trim().toLowerCase() : "custom";
  const objective = request.objective.trim();
  if (!objective) {
    throw new Error("Backtest context request objective cannot be empty.");
  }
  const symbols = dedupeStrings(
    (request.symbols.length > 0 ? request.symbols : defaultSymbols).map((symbol) => normalizeSymbol(symbol)),
  );
  return {
    contextType,
    objective,
    symbols,
    lookbackDays: clampInteger(request.lookbackDays, 1, 365, 14),
    maxItems: clampInteger(request.maxItems, 1, 50, 8),
  };
}

function buildCacheKey(request: BacktestContextRequest): string {
  return JSON.stringify({
    contextType: request.contextType,
    objective: request.objective.toLowerCase(),
    symbols: [...request.symbols].sort((left, right) => left.localeCompare(right)),
    lookbackDays: request.lookbackDays,
    maxItems: request.maxItems,
  });
}

function mergeContextSnapshots(
  existing: BacktestContextSnapshot[],
  incoming: BacktestContextSnapshot,
): BacktestContextSnapshot[] {
  const next = [...existing];
  const index = next.findIndex(
    (snapshot) => snapshot.date === incoming.date && snapshot.cacheKey === incoming.cacheKey,
  );
  if (index >= 0) {
    next[index] = incoming;
  } else {
    next.push(incoming);
  }
  return next.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function filterSafeContextMcpTools(tools: readonly McpListedTool[]): McpListedTool[] {
  return tools.filter((tool) => {
    const haystack = `${tool.server} ${tool.name} ${tool.description ?? ""}`.toLowerCase();
    return !/\b(create|update|delete|remove|write|append|patch|post|send|publish|install|restart|approve|submit|place|buy|sell|order)\b/.test(haystack);
  });
}

function normalizeHistoricalAsOf(value: string, currentDate: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid historical context field 'asOf'.");
  }
  const normalized = parsed.toISOString();
  if (normalized.slice(0, 10) >= currentDate) {
    throw new Error(
      `Historical context asOf '${normalized}' is not earlier than the current trading date '${currentDate}'.`,
    );
  }
  return normalized;
}

function normalizePayloadJson(value: unknown): string | null {
  if (value == null || value === "") {
    return null;
  }
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Optional field 'payloadJson' must be a JSON string when provided.");
  }
  JSON.parse(value);
  return compactText(value.trim(), 8000);
}

function normalizeStringArray(
  value: unknown,
  label: string,
  maxItems: number,
  maxLength: number,
): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Field '${label}' must be a non-empty string array.`);
  }
  return dedupeStrings(
    value
      .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
      .slice(0, maxItems)
      .map((item) => compactText(item.trim(), maxLength)),
  );
}

function normalizeOptionalStringArray(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return dedupeStrings(
    value
      .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
      .slice(0, maxItems)
      .map((item) => compactText(item.trim(), maxLength)),
  );
}

function clampInteger(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

function normalizeObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function requiredTrimmedString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing required string parameter '${label}'.`);
  }
  return value.trim();
}

function finiteOptionalNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim()))];
}

function compactText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}
