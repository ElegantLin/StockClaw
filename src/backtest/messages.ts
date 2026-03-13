import type { BacktestFillRecord, BacktestJob, BacktestJobSubmissionResult, BacktestJobSummary } from "./types.js";

type BacktestJobListItem = Pick<
  BacktestJobSummary,
  "jobId" | "symbols" | "dateFrom" | "dateTo" | "submittedAt" | "reportSummary" | "error" | "deliveredAt"
> & {
  status: string;
};

export function buildBacktestJobSubmissionNote(result: Pick<BacktestJobSubmissionResult, "jobId" | "kind" | "dateFrom" | "dateTo" | "symbols">): string {
  const symbols = result.symbols.length > 0 ? result.symbols.join(", ") : "current portfolio";
  return [
    `Backtest job queued: ${result.jobId}`,
    `Target: ${symbols}`,
    `Kind: ${result.kind}`,
    `Window: ${result.dateFrom} to ${result.dateTo}`,
    "The run will continue in the background and the final result will be sent back to this session.",
  ].join("\n");
}

export function buildBacktestJobResultMessage(job: BacktestJob): string {
  const symbols = job.symbols.length > 0 ? job.symbols.join(", ") : "current portfolio";
  if (job.status === "failed" || !job.report) {
    const lines = [
      `Backtest job failed: ${job.jobId}`,
      `Target: ${symbols}`,
      `Window: ${job.input.dateFrom} to ${job.input.dateTo}`,
      `Error: ${job.error || "unknown backtest failure"}`,
    ];
    appendArtifactHints(lines, job);
    return lines.join("\n");
  }
  const report = job.report;
  const lines = [
    `Backtest job completed: ${job.jobId}`,
    `Target: ${symbols}`,
    `Window: ${job.input.dateFrom} to ${job.input.dateTo}`,
    `Return: ${formatPct(report.totalReturnPct)}`,
    `Max Drawdown: ${formatPct(report.maxDrawdownPct)}`,
    `Orders: filled=${report.filledOrders}, rejected=${report.rejectedOrders}`,
    `Start Equity: ${report.startEquity.toFixed(2)}`,
    `End Equity: ${report.endEquity.toFixed(2)}`,
    `Run ID: ${report.runId}`,
  ];
  if (report.warnings.length > 0) {
    lines.push(`Warnings: ${summarizeWarnings(report.warnings)}`);
  }
  if (report.filledTrades.length > 0) {
    lines.push("Filled Trades:");
    for (const trade of report.filledTrades.slice(0, 8)) {
      lines.push(formatFilledTrade(trade));
    }
    if (report.filledTrades.length > 8) {
      lines.push(`... ${report.filledTrades.length - 8} more filled trade(s) in the report file.`);
    }
  }
  if (report.rejectedTrades.length > 0) {
    lines.push("Rejected Trades:");
    for (const trade of report.rejectedTrades.slice(0, 6)) {
      lines.push(formatRejectedTrade(trade));
    }
    if (report.rejectedTrades.length > 6) {
      lines.push(`... ${report.rejectedTrades.length - 6} more rejected trade(s) in the report file.`);
    }
  }
  appendArtifactHints(lines, job);
  lines.push("", report.summary);
  return lines.join("\n");
}

export function buildBacktestJobResultMarkdown(job: BacktestJob): string {
  const symbols = job.symbols.length > 0 ? job.symbols.join(", ") : "current portfolio";
  const lines = [
    "# Backtest Result",
    "",
    `- Job ID: ${job.jobId}`,
    `- Status: ${job.status}`,
    `- Kind: ${job.input.kind}`,
    `- Target: ${symbols}`,
    `- Window: ${job.input.dateFrom} to ${job.input.dateTo}`,
  ];
  if (job.runId) {
    lines.push(`- Run ID: ${job.runId}`);
  }
  if (job.datasetId) {
    lines.push(`- Dataset ID: ${job.datasetId}`);
  }
  if (job.report) {
    lines.push(
      "",
      "## Metrics",
      "",
      `- Return: ${formatPct(job.report.totalReturnPct)}`,
      `- Max Drawdown: ${formatPct(job.report.maxDrawdownPct)}`,
      `- Filled Orders: ${job.report.filledOrders}`,
      `- Rejected Orders: ${job.report.rejectedOrders}`,
      `- Start Equity: ${job.report.startEquity.toFixed(2)}`,
      `- End Equity: ${job.report.endEquity.toFixed(2)}`,
      "",
      "## Filled Trades",
      "",
      ...formatTradeMarkdown(job.report.filledTrades, "filled"),
      "",
      "## Rejected Trades",
      "",
      ...formatTradeMarkdown(job.report.rejectedTrades, "rejected"),
      "",
      "## Summary",
      "",
      job.report.summary,
    );
    if (job.report.warnings.length > 0) {
      lines.push("", "## Warnings", "", ...job.report.warnings.map((warning) => `- ${warning}`));
    }
    if (job.reportPath || job.tracePath) {
      lines.push("", "## Artifacts", "");
      if (job.reportPath) {
        lines.push(`- Report File: ${job.reportPath}`);
      }
      if (job.tracePath) {
        lines.push(`- Trace File: ${job.tracePath}`);
      }
    }
  } else if (job.error) {
    lines.push("", "## Error", "", job.error);
  }
  return lines.join("\n");
}

export function sortBacktestJobListItems<T extends BacktestJobListItem>(jobs: T[]): T[] {
  return [...jobs].sort((left, right) => right.submittedAt.localeCompare(left.submittedAt));
}

export function formatBacktestJobListItem(job: BacktestJobListItem): string {
  const target = job.symbols.length > 0 ? job.symbols.join(", ") : "current portfolio";
  const detail =
    job.status === "failed"
      ? job.error || "failed"
      : job.reportSummary || job.status;
  const statusLabel =
    (job.status === "completed" || job.status === "failed") && !job.deliveredAt
      ? `${job.status}; notifying`
      : job.status;
  return `- ${job.jobId} [${statusLabel}] ${target} ${job.dateFrom}..${job.dateTo} ${detail}`;
}

function formatPct(value: number): string {
  return `${value.toFixed(2)}%`;
}

function summarizeWarnings(warnings: string[]): string {
  if (warnings.length <= 2) {
    return warnings.join(" | ");
  }
  return `${warnings.slice(0, 2).join(" | ")} | ${warnings.length - 2} more warning(s)`;
}

function formatFilledTrade(trade: BacktestFillRecord): string {
  return `- ${trade.date} ${trade.side.toUpperCase()} ${trade.symbol} qty=${trade.quantity} fill=${trade.filledPrice.toFixed(2)} netCash=${trade.netCashImpact.toFixed(2)} rationale=${trade.rationale}`;
}

function formatRejectedTrade(trade: BacktestFillRecord): string {
  return `- ${trade.date} ${trade.side.toUpperCase()} ${trade.symbol} qty=${trade.quantity} reason=${trade.reason ?? "rejected"}`;
}

function formatTradeMarkdown(trades: BacktestFillRecord[], kind: "filled" | "rejected"): string[] {
  if (trades.length === 0) {
    return [`- No ${kind} trades.`];
  }
  return trades.map((trade) => {
    if (kind === "filled") {
      return formatFilledTrade(trade);
    }
    return formatRejectedTrade(trade);
  });
}

function appendArtifactHints(lines: string[], job: BacktestJob): void {
  if (job.reportPath && job.tracePath) {
    lines.push("Artifacts: detailed report and trace saved locally.");
    return;
  }
  if (job.reportPath) {
    lines.push("Artifacts: detailed report saved locally.");
    return;
  }
  if (job.tracePath) {
    lines.push("Artifacts: trace log saved locally.");
  }
}
