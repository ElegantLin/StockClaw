import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { PortfolioStore } from "../src/portfolio/store.js";

describe("PortfolioStore.patch", () => {
  it("upserts positions and scalar account fields", async () => {
    const filePath = path.join(os.tmpdir(), `stock-claw-portfolio-patch-${Date.now()}.json`);
    const store = new PortfolioStore(filePath);

    await store.replace({
      accountId: "paper",
      mode: "paper",
      cash: 1000,
      equity: 1000,
      buyingPower: 1000,
      positions: [],
      openOrders: [],
      updatedAt: "2026-03-08T00:00:00.000Z",
    });

    const next = await store.patch({
      cash: 800,
      positions: [
        {
          symbol: "nvda.us",
          quantity: 2,
          avgCost: 100,
          marketPrice: 110,
          currency: "USD",
        },
      ],
    });

    expect(next.cash).toBe(800);
    expect(next.positions).toHaveLength(1);
    expect(next.positions[0]?.symbol).toBe("NVDA.US");
    expect(next.positions[0]?.marketValue).toBe(220);
    expect(next.equity).toBe(1020);
    expect(next.buyingPower).toBe(800);
  });
});
