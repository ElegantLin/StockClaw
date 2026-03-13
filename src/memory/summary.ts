import type { PortfolioSnapshot } from "../types.js";

export function buildPortfolioSummary(snapshot: PortfolioSnapshot): string {
  const lines = ["# Portfolio Summary", ""];
  lines.push(`- Account ID: ${snapshot.accountId}`);
  lines.push(`- Mode: ${snapshot.mode}`);
  lines.push(`- Cash: ${snapshot.cash.toFixed(2)}`);
  if (snapshot.equity != null) {
    lines.push(`- Equity: ${snapshot.equity.toFixed(2)}`);
  }
  if (snapshot.buyingPower != null) {
    lines.push(`- Buying Power: ${snapshot.buyingPower.toFixed(2)}`);
  }
  lines.push("");
  lines.push("## Positions");
  lines.push("");
  if (snapshot.positions.length === 0) {
    lines.push("- No open positions.");
  } else {
    for (const position of snapshot.positions) {
      lines.push(
        `- ${position.symbol}: qty=${position.quantity}, avg_cost=${position.avgCost}, market_price=${position.marketPrice ?? "n/a"}, market_value=${position.marketValue ?? "n/a"}, currency=${position.currency}`,
      );
    }
  }
  lines.push("");
  lines.push("## Open Orders");
  lines.push("");
  if (snapshot.openOrders.length === 0) {
    lines.push("- No open orders.");
  } else {
    for (const order of snapshot.openOrders) {
      lines.push(`- ${JSON.stringify(order)}`);
    }
  }
  return lines.join("\n");
}
