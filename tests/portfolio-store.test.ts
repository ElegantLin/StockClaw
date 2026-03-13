import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { PortfolioStore } from "../src/portfolio/store.js";

describe("PortfolioStore", () => {
  it("updates cash and position quantity after fills", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-portfolio-"));
    const store = new PortfolioStore(path.join(dir, "portfolio.json"));
    await store.replace({
      accountId: "default",
      mode: "paper",
      cash: 1000,
      equity: 1000,
      buyingPower: 1000,
      positions: [],
      openOrders: [],
      updatedAt: "",
    });

    const afterBuy = await store.applyFill({
      symbol: "AAPL.US",
      side: "buy",
      quantity: 2,
      price: 100,
      timestamp: "2026-03-08T00:00:00.000Z",
      currency: "USD",
    });
    expect(afterBuy.cash).toBe(800);
    expect(afterBuy.positions[0]?.quantity).toBe(2);
    expect(afterBuy.equity).toBe(1000);
    expect(afterBuy.buyingPower).toBe(800);

    const afterSell = await store.applyFill({
      symbol: "AAPL.US",
      side: "sell",
      quantity: 1,
      price: 120,
      timestamp: "2026-03-08T00:01:00.000Z",
      currency: "USD",
    });
    expect(afterSell.cash).toBe(920);
    expect(afterSell.positions[0]?.quantity).toBe(1);
    expect(afterSell.equity).toBe(1040);
    expect(afterSell.buyingPower).toBe(920);
  });

  it("normalizes legacy snapshots that are missing optional arrays", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-portfolio-"));
    const filePath = path.join(dir, "portfolio.json");
    await writeFile(
      filePath,
      JSON.stringify({
        accountId: "paper-main",
        mode: "paper",
        cash: 10000,
        equity: 10000,
        buyingPower: 10000,
        positions: [],
      }),
      "utf8",
    );
    const store = new PortfolioStore(filePath);

    const loaded = await store.load();

    expect(loaded.positions).toEqual([]);
    expect(loaded.openOrders).toEqual([]);
    expect(loaded.updatedAt).toBe("");
    expect(loaded.cash).toBe(10000);
  });
});
