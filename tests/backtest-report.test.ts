import { describe, expect, it } from "vitest";

import { buildBacktestReport } from "../src/backtest/report.js";
import type { BacktestRun } from "../src/backtest/types.js";

describe("buildBacktestReport", () => {
  it("uses failed wording and includes the underlying error for failed runs", () => {
    const run: BacktestRun = {
      runId: "run-1",
      datasetId: "dataset-1",
      parentSessionId: "web:test",
      status: "failed",
      kind: "asset",
      dataset: {
        datasetId: "dataset-1",
        runId: "run-1",
        kind: "asset",
        preparedBySessionId: "web:test",
        parentSessionId: "web:test",
        rootUserMessage: "backtest AAPL",
        dateFrom: "2026-01-02",
        dateTo: "2026-01-08",
        symbols: ["AAPL.US"],
        provider: {
          server: "stub",
          historyTool: "history",
          tradeDatesTool: "calendar",
          frequency: "1d",
          adjustFlag: "0",
          format: "json",
          selectedAt: "2026-03-11T00:00:00.000Z",
        },
        executionPolicy: {
          buyPrice: "open",
          sellPrice: "close",
          feesBps: 0,
          slippageBps: 0,
          spawnSpecialists: false,
          maxLookbackBars: 120,
        },
        initialPortfolio: {
          accountId: "backtest",
          mode: "backtest",
          cash: 10000,
          equity: 10000,
          buyingPower: 10000,
          positions: [],
          openOrders: [],
          updatedAt: "",
        },
        barsBySymbol: {
          "AAPL.US": [
            {
              date: "2026-01-02",
              open: 100,
              high: 101,
              low: 99,
              close: 100,
              volume: 1000,
              turnover: 100000,
              rawTime: null,
            },
          ],
        },
        calendar: ["2026-01-02", "2026-01-05", "2026-01-06"],
        warnings: [],
        preparedAt: "2026-03-11T00:00:00.000Z",
      },
      decisionSessions: [],
      contextSnapshots: [],
      fills: [],
      portfolioSnapshots: [
        {
          accountId: "backtest",
          mode: "backtest",
          cash: 10000,
          equity: 10000,
          buyingPower: 10000,
          positions: [],
          openOrders: [],
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
      ],
      report: null,
      error: "Unhandled stop reason: network_error",
      preparedAt: "2026-03-11T00:00:00.000Z",
      startedAt: "2026-03-11T00:01:00.000Z",
      completedAt: "2026-03-11T00:02:00.000Z",
    };

    const report = buildBacktestReport(run);

    expect(report.status).toBe("failed");
    expect(report.summary).toContain("failed");
    expect(report.summary).toContain("Processed trading days: 1/3");
    expect(report.summary).toContain("Unhandled stop reason: network_error");
  });
});
