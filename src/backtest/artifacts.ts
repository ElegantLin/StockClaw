import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { BacktestJob, BacktestRun, BacktestTraceEvent } from "./types.js";

interface BacktestTraceSinkEvent {
  timestamp?: string;
  level?: BacktestTraceEvent["level"];
  type: string;
  data: Record<string, unknown>;
}

export interface BacktestTraceSink {
  log(event: BacktestTraceSinkEvent): Promise<void>;
}

export class BacktestArtifactService {
  private static readonly queues = new Map<string, Promise<void>>();

  constructor(
    private readonly traceRoot: string = "data/.backtest-logs",
    private readonly reportRoot: string = "data/.backtest-reports",
  ) {}

  tracePathFor(artifactId: string): string {
    return path.resolve(this.traceRoot, `${artifactId}.jsonl`);
  }

  reportPathFor(artifactId: string): string {
    return path.resolve(this.reportRoot, `${artifactId}.md`);
  }

  createTraceSink(params: { artifactId: string; jobId: string | null; runId: string | null }): BacktestTraceSink {
    return {
      log: async (event) => {
        await this.appendTrace(params.artifactId, {
          timestamp: event.timestamp ?? new Date().toISOString(),
          jobId: params.jobId,
          runId: params.runId,
          level: event.level ?? "info",
          type: event.type,
          data: event.data,
        });
      },
    };
  }

  async appendTrace(artifactId: string, event: BacktestTraceEvent): Promise<string> {
    const target = this.tracePathFor(artifactId);
    await this.enqueue(target, async () => {
      await mkdir(path.dirname(target), { recursive: true });
      await appendFile(target, `${JSON.stringify(event)}\n`, "utf8");
    });
    return target;
  }

  async writeMarkdownReport(artifactId: string, content: string): Promise<string> {
    const target = this.reportPathFor(artifactId);
    await this.enqueue(target, async () => {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, `${content.trim()}\n`, "utf8");
    });
    return target;
  }

  private async enqueue(target: string, task: () => Promise<void>): Promise<void> {
    const previous = BacktestArtifactService.queues.get(target) ?? Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(task);
    BacktestArtifactService.queues.set(target, next);
    try {
      await next;
    } finally {
      if (BacktestArtifactService.queues.get(target) === next) {
        BacktestArtifactService.queues.delete(target);
      }
    }
  }
}

export function buildBacktestMarkdownReport(params: {
  job: BacktestJob;
  run: BacktestRun;
  tracePath?: string | null;
}): string {
  const report = params.run.report;
  if (!report) {
    return [
      "# Backtest Report",
      "",
      `- Job ID: ${params.job.jobId}`,
      `- Run ID: ${params.run.runId}`,
      `- Status: ${params.run.status}`,
      `- Error: ${params.run.error ?? "unknown"}`,
      ...(params.tracePath ? [`- Trace: ${params.tracePath}`] : []),
    ].join("\n");
  }

  const lines = [
    "# Backtest Report",
    "",
    `- Job ID: ${params.job.jobId}`,
    `- Run ID: ${params.run.runId}`,
    `- Dataset ID: ${params.run.datasetId}`,
    `- Status: ${params.run.status}`,
    `- Kind: ${params.run.kind}`,
    `- Symbols: ${report.symbols.join(", ")}`,
    `- Window: ${params.run.dataset.dateFrom} to ${params.run.dataset.dateTo}`,
    `- Trading Days: ${report.tradingDays}`,
    `- Provider: ${params.run.dataset.provider.server}/${params.run.dataset.provider.historyTool}`,
    `- Prepared At: ${params.run.preparedAt}`,
    `- Started At: ${report.startedAt}`,
    `- Completed At: ${report.completedAt}`,
    ...(params.tracePath ? [`- Trace: ${params.tracePath}`] : []),
    "",
    "## Metrics",
    "",
    `- Start Equity: ${report.startEquity.toFixed(2)} USD`,
    `- End Equity: ${report.endEquity.toFixed(2)} USD`,
    `- Total Return: ${report.totalReturnPct.toFixed(2)}%`,
    `- Max Drawdown: ${report.maxDrawdownPct.toFixed(2)}%`,
    `- Filled Orders: ${report.filledOrders}`,
    `- Rejected Orders: ${report.rejectedOrders}`,
    "",
    "## Summary",
    "",
    report.summary,
  ];

  if (report.warnings.length > 0) {
    lines.push("", "## Warnings", "", ...report.warnings.map((warning) => `- ${warning}`));
  }

  lines.push(
    "",
    "## Filled Trades",
    "",
    "| Date | Side | Symbol | Qty | Price | Net Cash | Rationale |",
    "| --- | --- | --- | ---: | ---: | ---: | --- |",
  );
  if (report.filledTrades.length === 0) {
    lines.push("| - | - | - | 0 | 0.00 | 0.00 | No filled trades |");
  } else {
    for (const fill of report.filledTrades) {
      lines.push(
        `| ${fill.date} | ${fill.side.toUpperCase()} | ${fill.symbol} | ${fill.quantity} | ${fill.filledPrice.toFixed(2)} | ${fill.netCashImpact.toFixed(2)} | ${escapePipe(fill.rationale)} |`,
      );
    }
  }

  if (report.rejectedTrades.length > 0) {
    lines.push(
      "",
      "## Rejected Trades",
      "",
      "| Date | Side | Symbol | Qty | Reason |",
      "| --- | --- | --- | ---: | --- |",
    );
    for (const fill of report.rejectedTrades) {
      lines.push(
        `| ${fill.date} | ${fill.side.toUpperCase()} | ${fill.symbol} | ${fill.quantity} | ${escapePipe(fill.reason ?? "rejected")} |`,
      );
    }
  }

  lines.push(
    "",
    "## Daily Decisions",
    "",
    "| Date | Session | Tool Calls | Specialists | Root Output |",
    "| --- | --- | ---: | ---: | --- |",
  );
  for (const session of params.run.decisionSessions) {
    lines.push(
      `| ${session.date} | ${session.sessionId} | ${session.toolCalls.length} | ${session.specialists.length} | ${escapePipe(compactText(session.rootMessage, 160))} |`,
    );
  }

  lines.push(
    "",
    "## Context Snapshots",
    "",
    "| Date | Type | Symbols | As Of | Provider | Title | Summary |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  );
  if (params.run.contextSnapshots.length === 0) {
    lines.push("| - | - | - | - | - | - | No extra context snapshots requested |");
  } else {
    for (const snapshot of params.run.contextSnapshots) {
      lines.push(
        `| ${snapshot.date} | ${escapePipe(snapshot.request.contextType)} | ${escapePipe(snapshot.symbols.join(", "))} | ${snapshot.asOf} | ${escapePipe(`${snapshot.providerType}/${snapshot.providerName}/${snapshot.toolName}`)} | ${escapePipe(snapshot.title)} | ${escapePipe(compactText(snapshot.summary, 140))} |`,
      );
    }
  }

  lines.push(
    "",
    "## Ending Portfolio",
    "",
    "```json",
    JSON.stringify(report.endingPortfolio, null, 2),
    "```",
  );

  return lines.join("\n");
}

function compactText(input: string, maxLength: number): string {
  const normalized = input.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function escapePipe(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n+/g, " ").trim();
}
