import type { PortfolioSnapshot } from "../types.js";
import type { BacktestFillRecord, BacktestReport, BacktestRun } from "./types.js";

export function buildBacktestReport(run: BacktestRun): BacktestReport {
  if (!run.startedAt || !run.completedAt) {
    throw new Error(`Backtest run ${run.runId} does not have complete timing metadata.`);
  }
  const startSnapshot = run.dataset.initialPortfolio;
  const endSnapshot = run.portfolioSnapshots.at(-1) ?? run.dataset.initialPortfolio;
  const equityCurve = run.portfolioSnapshots.map((snapshot) => ({
    date: snapshot.updatedAt.slice(0, 10),
    cash: snapshot.cash,
    equity: snapshot.equity ?? snapshot.cash,
  }));
  const startEquity = startSnapshot.equity ?? startSnapshot.cash;
  const endEquity = endSnapshot.equity ?? endSnapshot.cash;
  const filledOrders = run.fills.filter((fill) => fill.status === "filled");
  const rejectedOrders = run.fills.filter((fill) => fill.status === "rejected");
  const maxDrawdownPct = computeMaxDrawdown(run.portfolioSnapshots, startEquity);

  return {
    runId: run.runId,
    datasetId: run.datasetId,
    parentSessionId: run.parentSessionId,
    kind: run.kind,
    symbols: [...run.dataset.symbols],
    status: run.status === "completed" ? "completed" : "failed",
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    tradingDays: run.dataset.calendar.length,
    filledOrders: filledOrders.length,
    rejectedOrders: rejectedOrders.length,
    startEquity,
    endEquity,
    totalReturnPct: percentageDelta(startEquity, endEquity),
    maxDrawdownPct,
    equityCurve,
    endingPortfolio: structuredClone(endSnapshot),
    filledTrades: filledOrders.map((fill) => ({ ...fill })),
    rejectedTrades: rejectedOrders.map((fill) => ({ ...fill })),
    summary: buildSummary(run, startEquity, endEquity, filledOrders, rejectedOrders, maxDrawdownPct),
    warnings: [...run.dataset.warnings],
  };
}

function buildSummary(
  run: BacktestRun,
  startEquity: number,
  endEquity: number,
  filledOrders: BacktestFillRecord[],
  rejectedOrders: BacktestFillRecord[],
  maxDrawdownPct: number,
): string {
  const returnPct = percentageDelta(startEquity, endEquity);
  const processedDays = run.portfolioSnapshots.length;
  const lines =
    run.status === "completed"
      ? [
          `Backtest ${run.runId} completed for ${run.dataset.symbols.join(", ")}.`,
          `Period: ${run.dataset.dateFrom} to ${run.dataset.dateTo}.`,
          `Start equity: ${startEquity.toFixed(2)} USD.`,
          `End equity: ${endEquity.toFixed(2)} USD.`,
          `Total return: ${returnPct.toFixed(2)}%.`,
          `Filled orders: ${filledOrders.length}.`,
          `Rejected orders: ${rejectedOrders.length}.`,
          `Max drawdown: ${maxDrawdownPct.toFixed(2)}%.`,
        ]
      : [
          `Backtest ${run.runId} failed for ${run.dataset.symbols.join(", ")}.`,
          `Period: ${run.dataset.dateFrom} to ${run.dataset.dateTo}.`,
          `Processed trading days: ${processedDays}/${run.dataset.calendar.length}.`,
          `Start equity: ${startEquity.toFixed(2)} USD.`,
          `End equity: ${endEquity.toFixed(2)} USD.`,
          `Partial return: ${returnPct.toFixed(2)}%.`,
          `Filled orders: ${filledOrders.length}.`,
          `Rejected orders: ${rejectedOrders.length}.`,
          `Max drawdown: ${maxDrawdownPct.toFixed(2)}%.`,
          ...(run.error ? [`Error: ${run.error}.`] : []),
        ];
  return lines.join(" ");
}

function computeMaxDrawdown(snapshots: PortfolioSnapshot[], startingEquity: number): number {
  let peak = startingEquity;
  let maxDrawdown = 0;
  for (const snapshot of snapshots) {
    const equity = snapshot.equity ?? snapshot.cash;
    if (equity > peak) {
      peak = equity;
    }
    if (peak > 0) {
      const drawdown = ((peak - equity) / peak) * 100;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }
  }
  return Math.round(maxDrawdown * 100) / 100;
}

function percentageDelta(start: number, end: number): number {
  if (!Number.isFinite(start) || start === 0) {
    return 0;
  }
  return Math.round((((end - start) / start) * 100) * 100) / 100;
}
