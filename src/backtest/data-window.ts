import type { BacktestDataset, BacktestWindow } from "./types.js";

export function createBacktestWindow(dataset: BacktestDataset, currentDate: string): BacktestWindow {
  const dateIndex = dataset.calendar.indexOf(currentDate);
  if (dateIndex < 0) {
    throw new Error(`Unknown trading date '${currentDate}' in dataset ${dataset.datasetId}.`);
  }
  const priorDate = dateIndex > 0 ? dataset.calendar[dateIndex - 1] ?? null : null;
  const lookbackBars = Math.max(1, dataset.executionPolicy.maxLookbackBars);
  const barsBySymbol = Object.fromEntries(
    Object.entries(dataset.barsBySymbol).map(([symbol, bars]) => {
      const visible = bars.filter((bar) => bar.date < currentDate);
      return [symbol, visible.slice(Math.max(0, visible.length - lookbackBars))];
    }),
  );
  return {
    currentDate,
    priorDate,
    lookbackBars,
    barsBySymbol,
  };
}
