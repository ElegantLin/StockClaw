import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { BacktestStore } from "../src/state/backtest-store.js";
import type { BacktestRun } from "../src/backtest/types.js";

describe("BacktestStore", () => {
  it("persists prepared runs and exposes summaries", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-backtest-store-"));
    const store = new BacktestStore(path.join(dir, "backtests.json"), path.join(dir, "runs"));
    const run: BacktestRun = {
      runId: "run-1",
      datasetId: "dataset-1",
      parentSessionId: "web:test",
      status: "prepared",
      kind: "asset",
      dataset: {
        datasetId: "dataset-1",
        runId: "run-1",
        kind: "asset",
        preparedBySessionId: "web:test",
        parentSessionId: "web:test",
        rootUserMessage: "Backtest AAPL",
        dateFrom: "2026-01-02",
        dateTo: "2026-01-05",
        symbols: ["AAPL.US"],
        provider: {
          server: "stub",
          historyTool: "get_historical_k_data",
          tradeDatesTool: "get_trade_dates",
          frequency: "1d",
          adjustFlag: "0",
          format: "json",
          selectedAt: "2026-01-02T00:00:00.000Z",
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
          cash: 1000,
          equity: 1000,
          buyingPower: 1000,
          positions: [],
          openOrders: [],
          updatedAt: "",
        },
        barsBySymbol: {
          "AAPL.US": [
            { date: "2026-01-02", open: 100, high: 101, low: 99, close: 100.5, volume: 1000, turnover: 100500, rawTime: null },
          ],
        },
        calendar: ["2026-01-02"],
        warnings: [],
        preparedAt: "2026-01-02T00:00:00.000Z",
      },
      decisionSessions: [],
      contextSnapshots: [],
      fills: [],
      portfolioSnapshots: [],
      report: null,
      error: null,
      preparedAt: "2026-01-02T00:00:00.000Z",
      startedAt: null,
      completedAt: null,
    };

    await store.savePreparedRun(run);

    const loaded = await store.getRun("run-1");
    const list = await store.list();

    expect(loaded?.dataset.symbols).toEqual(["AAPL.US"]);
    expect(list).toHaveLength(1);
    expect(list[0]?.status).toBe("prepared");
    expect(list[0]?.provider.server).toBe("stub");
  });
});
