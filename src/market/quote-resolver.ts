import { randomUUID } from "node:crypto";

import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";

import { runMcporter } from "../mcporter/runner.js";
import type { McpListedTool } from "../mcp/runtime.js";
import type { PiRuntime } from "../pi/runtime.js";
import type { PromptRegistry } from "../prompts/registry.js";
import {
  hasExplicitDestructiveConfirmation,
  isDestructiveCommand,
  runLocalShellCommand,
  tokenizeCommand,
} from "../tools/support.js";
import type { ToolCallRecord } from "../types.js";
import { normalizeSymbol } from "./symbols.js";

const DEFAULT_MAX_ATTEMPTS = 3;
const RETRYABLE_PATTERNS = [
  "network_error",
  "rate_limit",
  "timed out",
  "timeout",
  "econnreset",
  "socket hang up",
  "temporarily unavailable",
];

interface QuoteCommitPayload {
  symbol: string;
  price: number;
  field: string;
  timestamp: string;
  currency: string;
  providerType: string;
  providerName: string;
  toolName: string;
  rawEvidence: string;
  warnings: string[];
}

export interface QuoteResolutionRequest {
  sessionId: string;
  rootUserMessage: string;
  symbol: string;
  purpose: string;
}

export interface ResolvedMarketQuote {
  symbol: string;
  price: number;
  field: string;
  timestamp: string;
  currency: string;
  providerType: string;
  providerName: string;
  toolName: string;
  rawEvidence: string;
  warnings: string[];
  resolutionSessionId: string;
  resolutionMessage: string;
  resolutionToolCalls: ToolCallRecord[];
}

export class QuoteResolverService {
  constructor(
    private readonly piRuntime: PiRuntime,
    private readonly prompts: PromptRegistry,
    private readonly availableMcpTools: () => McpListedTool[],
  ) {}

  normalizeSymbol(symbol: string): string {
    return normalizeSymbol(symbol);
  }

  async resolveQuote(params: QuoteResolutionRequest): Promise<ResolvedMarketQuote> {
    const normalizedSymbol = normalizeSymbol(params.symbol);
    const sessionId = `quote-resolve:${params.sessionId}:${randomUUID()}`;
    const committed: { value: QuoteCommitPayload | null } = { value: null };
    const run = await runWithTransientRetry({
      run: async () =>
        this.piRuntime.runEphemeral({
          sessionKey: sessionId,
          systemPrompt: await this.buildSystemPrompt(),
          userPrompt: this.buildUserPrompt({
            rootUserMessage: params.rootUserMessage,
            symbol: normalizedSymbol,
            purpose: params.purpose,
            safeMcpTools: filterSafeQuoteMcpTools(this.availableMcpTools()),
          }),
          customTools: [
            createQuoteExecCommandTool(params.rootUserMessage),
            createCommitQuoteTool({
              requestedSymbol: normalizedSymbol,
              commit(value) {
                committed.value = value;
              },
            }),
          ],
        }),
    });

    if (!committed.value) {
      throw new Error(`Quote resolution did not commit quote data. Final root output: ${run.message || "(empty)"}`);
    }

    return {
      ...committed.value,
      resolutionSessionId: sessionId,
      resolutionMessage: run.message,
      resolutionToolCalls: run.toolCalls,
    };
  }

  private async buildSystemPrompt(): Promise<string> {
    const base = await this.prompts.composeAgentPrompt("orchestrator");
    const workflow = await this.prompts.composeWorkflowPrompt("quote_resolution_mode");
    return [base, workflow].filter(Boolean).join("\n\n").trim();
  }

  private buildUserPrompt(params: {
    rootUserMessage: string;
    symbol: string;
    purpose: string;
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
      "Your task is to resolve one live market quote for a deterministic internal operation.",
      "Do not answer with prose only. You must call market_commit_quote exactly once.",
      "",
      `Requested symbol: ${params.symbol}`,
      `Purpose: ${params.purpose}`,
      "",
      "Preferred workflow:",
      "1. Check the active workflow guidance and available skills.",
      "2. Use exec_command to inspect or call discoverable external tools such as mcporter or local skill scripts.",
      "3. Prefer the freshest executable last-trade style quote. If unavailable, commit another clearly labeled field.",
      "4. If the source omits an explicit timestamp, use retrieval time and add a warning.",
      "5. Commit one structured quote and stop.",
      "",
      "Recommended command patterns:",
      "- mcporter list --output json",
      "- mcporter list <server> --schema --output json",
      "- mcporter call <server.tool> --output json --json '{\"codes\":[\"AAPL.US\"]}'",
      "",
      "Visible safe MCP tools discovered for this run:",
      mcpLines,
      "",
      "Commit contract:",
      "- symbol: normalized exchange-qualified symbol",
      "- price: numeric executable price",
      "- field: the exact quote field you used, such as last, bid, ask, open, close, or mid",
      "- timestamp: ISO timestamp for the quote or retrieval time",
      "- currency: quote currency, usually USD",
      "- providerType: source family such as mcp or skill",
      "- providerName: concrete provider or skill name",
      "- toolName: concrete external tool, command, or script name",
      "- rawEvidence: short evidence excerpt supporting the quote",
      "- warnings: optional factual caveats",
    ].join("\n");
  }
}

function createQuoteExecCommandTool(rootUserMessage: string): ToolDefinition {
  return {
    name: "exec_command",
    label: "Exec Command",
    description:
      "Run a read-only local shell command for discoverable external data workflows such as mcporter or local skill scripts. Destructive commands are blocked.",
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
      const timeoutMs = finiteOptionalNumber(raw.timeoutMs) ?? 30_000;
      const cwd = typeof raw.cwd === "string" && raw.cwd.trim() ? raw.cwd.trim() : undefined;
      const tokens = tokenizeCommand(command);
      const result = tokens[0] === "mcporter"
        ? await runMcporter(tokens.slice(1), process.env)
        : await runLocalShellCommand(command, { cwd, timeoutMs });
      const stdout = "stdout" in result ? result.stdout : "";
      const stderr = "stderr" in result ? result.stderr : "";
      const exitCode = typeof result.exitCode === "number" || result.exitCode === null ? result.exitCode : 0;
      return {
        content: [{ type: "text", text: [stdout, stderr].filter(Boolean).join("\n").trim() || "(no output)" }],
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

function createCommitQuoteTool(params: {
  requestedSymbol: string;
  commit(value: QuoteCommitPayload): void;
}): ToolDefinition {
  let committed: QuoteCommitPayload | null = null;
  return {
    name: "market_commit_quote",
    label: "Market Commit Quote",
    description: "Commit one structured live quote candidate for deterministic execution or trigger evaluation.",
    parameters: Type.Object({
      symbol: Type.String(),
      price: Type.Number(),
      field: Type.String(),
      timestamp: Type.String(),
      currency: Type.Optional(Type.String()),
      providerType: Type.String(),
      providerName: Type.String(),
      toolName: Type.String(),
      rawEvidence: Type.String(),
      warnings: Type.Optional(Type.Array(Type.String())),
    }),
    execute: async (_toolCallId, input) => {
      if (committed) {
        return {
          content: [{ type: "text", text: JSON.stringify(committed, null, 2) }],
          details: committed,
        };
      }
      const raw = normalizeObject(input);
      const payload = normalizeCommitPayload(raw, params.requestedSymbol);
      committed = payload;
      params.commit(payload);
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        details: payload,
      };
    },
  };
}

function normalizeCommitPayload(input: Record<string, unknown>, requestedSymbol: string): QuoteCommitPayload {
  const symbol = normalizeSymbol(requiredTrimmedString(input.symbol, "symbol"));
  if (symbol !== requestedSymbol) {
    throw new Error(`Committed quote symbol '${symbol}' does not match requested symbol '${requestedSymbol}'.`);
  }
  const price = finitePositiveNumber(input.price, "price");
  const field = requiredTrimmedString(input.field, "field").toLowerCase();
  const timestamp = normalizeTimestamp(requiredTrimmedString(input.timestamp, "timestamp"), "timestamp");
  const currency = typeof input.currency === "string" && input.currency.trim() ? input.currency.trim().toUpperCase() : "USD";
  return {
    symbol,
    price,
    field,
    timestamp,
    currency,
    providerType: requiredTrimmedString(input.providerType, "providerType"),
    providerName: requiredTrimmedString(input.providerName, "providerName"),
    toolName: requiredTrimmedString(input.toolName, "toolName"),
    rawEvidence: compactText(requiredTrimmedString(input.rawEvidence, "rawEvidence"), 4000),
    warnings: normalizeWarnings(input.warnings),
  };
}

function normalizeWarnings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => compactText(item.trim(), 240));
}

function filterSafeQuoteMcpTools(tools: readonly McpListedTool[]): McpListedTool[] {
  const safeKeywords = ["quote", "k_data", "price", "ticker", "snapshot", "stock", "market", "depth"];
  return tools.filter((tool) => {
    const haystack = `${tool.server} ${tool.name} ${tool.description || ""}`.toLowerCase();
    return safeKeywords.some((keyword) => haystack.includes(keyword));
  });
}

async function runWithTransientRetry<T>(params: { run(attempt: number): Promise<T> }): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= DEFAULT_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await params.run(attempt);
    } catch (error) {
      lastError = error;
      if (!isRetryableError(error) || attempt >= DEFAULT_MAX_ATTEMPTS) {
        throw error;
      }
      await sleep(Math.min(5_000, 1_000 * attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError || "unknown error"));
}

function isRetryableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error || "").toLowerCase();
  return RETRYABLE_PATTERNS.some((pattern) => message.includes(pattern));
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
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

function finitePositiveNumber(value: unknown, label: string): number {
  const numeric = finiteOptionalNumber(value);
  if (numeric == null || numeric <= 0) {
    throw new Error(`Invalid numeric parameter '${label}'.`);
  }
  return numeric;
}

function normalizeTimestamp(value: string, label: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid timestamp parameter '${label}'.`);
  }
  return date.toISOString();
}

function compactText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}
