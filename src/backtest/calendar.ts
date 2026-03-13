import type { BacktestHistoricalBar } from "./types.js";

export function inferTradingCalendar(
  barsBySymbol: Record<string, BacktestHistoricalBar[]>,
): string[] {
  const dates = new Set<string>();
  for (const bars of Object.values(barsBySymbol)) {
    for (const bar of bars) {
      if (bar.date) {
        dates.add(bar.date);
      }
    }
  }
  return [...dates].sort((left, right) => left.localeCompare(right));
}
