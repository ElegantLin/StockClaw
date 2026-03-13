import type { BacktestJobCounts } from "../backtest/types.js";
import { formatBacktestJobListItem, sortBacktestJobListItems } from "../backtest/messages.js";
import { buildStatusMessage as buildSharedStatusMessage } from "../status/message.js";
import { formatMemoryArtifactCategory } from "../memory/artifact-labels.js";
import type { MemoryArtifact, RuntimeInspectionPayload, SessionStatusPayload } from "../types.js";

export function buildPairingReply(params: {
  code: string;
}): string {
  return [
    "stock-claw: Telegram access is not paired yet.",
    "",
    `Pairing code: ${params.code}`,
    "",
    "Paste this code into the local stock-claw console to approve this Telegram chat.",
    "Alternative: npm run telegram-admin -- approve " + params.code,
    "After approval, message the bot again.",
  ].join("\n");
}

export function buildAdminPairingNotice(params: {
  code: string;
  username: string | null;
  userId: string;
}): string {
  return [
    "New Telegram pairing request.",
    "",
    `User: ${params.username ? `@${params.username}` : "(no username)"}`,
    `User ID: ${params.userId}`,
    `Code: ${params.code}`,
    "",
    `Approve locally by pasting ${params.code} into the stock-claw console, or run: npm run telegram-admin -- approve ${params.code}`,
  ].join("\n");
}

export function buildApprovedMessage(code: string): string {
  return `Pairing approved for code ${code}.`;
}

export function buildPendingListMessage(codes: string[]): string {
  if (codes.length === 0) {
    return "No pending Telegram pairing requests.";
  }
  return [
    "Pending pairing codes:",
    "",
    ...codes.map((code) => `- ${code}`),
    "",
    "Approve locally by pasting a code into the stock-claw console, or run: npm run telegram-admin -- approve <CODE>",
  ].join("\n");
}

export function buildPortfolioMessage(params: {
  accountId: string;
  mode: string;
  cash: number;
  equity: number | null;
  buyingPower: number | null;
  updatedAt: string;
  positions: Array<{
    symbol: string;
    quantity: number;
    avgCost: number;
    marketPrice: number | null;
    marketValue: number | null;
    currency: string;
  }>;
}): string {
  const lines = [
    "Portfolio Snapshot",
    "",
    `Account: ${params.accountId}`,
    `Mode: ${params.mode}`,
    `Cash: ${params.cash.toFixed(2)}`,
  ];
  if (params.equity != null) {
    lines.push(`Equity: ${params.equity.toFixed(2)}`);
  }
  if (params.buyingPower != null) {
    lines.push(`Buying Power: ${params.buyingPower.toFixed(2)}`);
  }
  lines.push(`Updated: ${params.updatedAt || "unknown"}`, "", "Positions:");
  if (params.positions.length === 0) {
    lines.push("- No open positions.");
  } else {
    for (const position of params.positions) {
      lines.push(
        `- ${position.symbol}: qty=${position.quantity}, avg=${position.avgCost.toFixed(2)}, last=${position.marketPrice?.toFixed?.(2) ?? "n/a"}, value=${position.marketValue?.toFixed?.(2) ?? "n/a"} ${position.currency}`,
      );
    }
  }
  lines.push("", "Commands: /status, /portfolio, /runtime, /spawns, /memory");
  return lines.join("\n");
}

export function buildStatusMessage(params: {
  session: SessionStatusPayload;
  runtime?: RuntimeInspectionPayload | null;
}): string {
  return buildSharedStatusMessage(params);
}

export function buildRuntimeMessage(params: {
  startedAt: string | null;
  lastReloadAt: string | null;
  lastReloadReason: string | null;
  reloadCount: number;
  reloadInFlight: boolean;
  pendingReason: string | null;
  lastError: string | null;
  cron?: {
    enabled: boolean;
    jobCount: number;
    activeJobCount: number;
    runningJobCount: number;
    lastTickAt: string | null;
  };
  mcp: Array<{ server: string; toolCount: number }>;
  skills: Array<{ name: string }>;
}): string {
  return [
    "Runtime Status",
    "",
    `Started: ${params.startedAt ?? "not started"}`,
    `Last Reload: ${params.lastReloadAt ?? "never"}`,
    `Reload Reason: ${params.lastReloadReason ?? "n/a"}`,
    `Reload Count: ${params.reloadCount}`,
    `Reload In Flight: ${params.reloadInFlight ? "yes" : "no"}`,
    `Pending Reason: ${params.pendingReason ?? "none"}`,
    `Last Error: ${params.lastError ?? "none"}`,
    "",
    "Cron:",
    `- Enabled: ${params.cron?.enabled ? "yes" : "no"}`,
    `- Jobs: ${params.cron?.jobCount ?? 0}`,
    `- Active: ${params.cron?.activeJobCount ?? 0}`,
    `- Running: ${params.cron?.runningJobCount ?? 0}`,
    `- Last Tick: ${params.cron?.lastTickAt ?? "never"}`,
    "",
    "MCP Servers:",
    ...(params.mcp.length
      ? params.mcp.map((entry) => `- ${entry.server}: ${entry.toolCount} tools`)
      : ["- none"]),
    "",
    "Skills:",
    ...(params.skills.length ? params.skills.map((entry) => `- ${entry.name}`) : ["- none"]),
  ].join("\n");
}

export function buildSpawnHistoryMessage(params: {
  sessionId: string;
  spawns: Array<{
    role: string;
    sessionId: string;
    toolCalls: Array<{ toolName: string }>;
  }>;
}): string {
  if (params.spawns.length === 0) {
    return `No spawned subagents recorded for ${params.sessionId}.`;
  }
  return [
    `Spawn History for ${params.sessionId}`,
    "",
    ...params.spawns.flatMap((spawn) => [
      `- ${spawn.role} (${spawn.sessionId})`,
      spawn.toolCalls.length
        ? `  tools: ${spawn.toolCalls.map((call) => call.toolName).join(", ")}`
        : "  tools: none",
    ]),
  ].join("\n");
}

export function buildMemoryArtifactsMessage(
  artifacts: Array<{ fileName: string; category: MemoryArtifact["category"]; updatedAt: string }>,
): string {
  if (artifacts.length === 0) {
    return "No recent memory artifacts found.";
  }
  return [
    "Recent Durable Memory Artifacts",
    "",
    ...artifacts.map(
      (artifact) => `- ${artifact.fileName} [${formatMemoryArtifactCategory(artifact.category)}] ${artifact.updatedAt}`,
    ),
  ].join("\n");
}

export function buildCronJobsMessage(params: {
  enabled: boolean;
  jobs: Array<{
    id: string;
    name: string;
    enabled: boolean;
    nextRunAt: string | null;
    lastOutcome: string;
  }>;
}): string {
  if (params.jobs.length === 0) {
    return `Cron Scheduler\n\nEnabled: ${params.enabled ? "yes" : "no"}\nNo scheduled jobs.`;
  }
  return [
    "Cron Scheduler",
    "",
    `Enabled: ${params.enabled ? "yes" : "no"}`,
    ...params.jobs.flatMap((job) => [
      "",
      `- ${job.name} (${job.id})`,
      `  enabled: ${job.enabled ? "yes" : "no"}`,
      `  next: ${job.nextRunAt ?? "n/a"}`,
      `  last outcome: ${job.lastOutcome}`,
    ]),
  ].join("\n");
}

export function buildBacktestJobsMessage(params: {
  sessionId: string;
  counts: BacktestJobCounts;
  jobs: Array<{
    jobId: string;
    status: string;
    symbols: string[];
    dateFrom: string;
    dateTo: string;
    submittedAt: string;
    reportSummary: string | null;
    error: string | null;
    deliveredAt: string | null;
  }>;
}): string {
  if (params.jobs.length === 0) {
    return [
      "Backtest Jobs",
      "",
      `Session: ${params.sessionId}`,
      "No backtest jobs recorded for this session.",
    ].join("\n");
  }
  const jobs = sortBacktestJobListItems(params.jobs);
  return [
    "Backtest Jobs",
    "",
    `Session: ${params.sessionId}`,
    `Active: ${params.counts.active}`,
    `Queued: ${params.counts.queued}`,
    `Preparing: ${params.counts.preparing}`,
    `Running: ${params.counts.running}`,
    `Completed: ${params.counts.completed}`,
    `Failed: ${params.counts.failed}`,
    "",
    ...jobs.map((job) => formatBacktestJobListItem(job)),
  ].join("\n");
}
