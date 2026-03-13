import type { PortfolioSnapshot, Position } from "../types.js";
import type { BacktestDataset, BacktestFillRecord, BacktestHistoricalBar, BacktestTradeIntent } from "./types.js";

export function createInitialBacktestPortfolio(snapshot: PortfolioSnapshot): PortfolioSnapshot {
  return normalizeSnapshot(structuredClone(snapshot));
}

export function applyBacktestTrade(params: {
  dataset: BacktestDataset;
  portfolio: PortfolioSnapshot;
  date: string;
  trade: BacktestTradeIntent;
  bar: BacktestHistoricalBar | null;
  sessionId: string;
  timestamp: string;
}): { portfolio: PortfolioSnapshot; fill: BacktestFillRecord } {
  const normalizedSymbol = normalizeSymbol(params.trade.symbol);
  const position = params.portfolio.positions.find((item) => item.symbol === normalizedSymbol);
  const requestedPrice =
    params.trade.side === "buy" ? params.bar?.open ?? NaN : params.bar?.close ?? NaN;
  if (!params.bar || !Number.isFinite(requestedPrice)) {
    return {
      portfolio: normalizeSnapshot(structuredClone(params.portfolio), params.date),
      fill: rejectedFill({
        date: params.date,
        symbol: normalizedSymbol,
        side: params.trade.side,
        quantity: params.trade.quantity,
        rationale: params.trade.rationale,
        sessionId: params.sessionId,
        createdAt: params.timestamp,
        reason: `No executable ${params.trade.side === "buy" ? "open" : "close"} price available for ${normalizedSymbol} on ${params.date}.`,
      }),
    };
  }

  const grossAmount = roundCurrency(requestedPrice * params.trade.quantity);
  const fees = roundCurrency((grossAmount * params.dataset.executionPolicy.feesBps) / 10_000);
  const slippage = roundCurrency((grossAmount * params.dataset.executionPolicy.slippageBps) / 10_000);
  const next = structuredClone(params.portfolio);

  if (params.trade.side === "buy") {
    const totalCashRequired = roundCurrency(grossAmount + fees + slippage);
    if (next.cash < totalCashRequired) {
      return {
        portfolio: normalizeSnapshot(next, params.date),
        fill: rejectedFill({
          date: params.date,
          symbol: normalizedSymbol,
          side: "buy",
          quantity: params.trade.quantity,
          rationale: params.trade.rationale,
          sessionId: params.sessionId,
          createdAt: params.timestamp,
          reason: `Insufficient cash to buy ${params.trade.quantity} shares of ${normalizedSymbol}.`,
        }),
      };
    }

    next.cash = roundCurrency(next.cash - totalCashRequired);
    if (!position) {
      next.positions.push({
        symbol: normalizedSymbol,
        quantity: params.trade.quantity,
        avgCost: roundCurrency(totalCashRequired / params.trade.quantity),
        marketPrice: requestedPrice,
        marketValue: roundCurrency(params.trade.quantity * requestedPrice),
        currency: "USD",
      });
    } else {
      const totalQty = position.quantity + params.trade.quantity;
      const totalCost = roundCurrency(position.quantity * position.avgCost + totalCashRequired);
      position.quantity = totalQty;
      position.avgCost = roundCurrency(totalCost / totalQty);
      position.marketPrice = requestedPrice;
      position.marketValue = roundCurrency(totalQty * requestedPrice);
    }

    return {
      portfolio: normalizeSnapshot(next, params.date),
      fill: {
        date: params.date,
        symbol: normalizedSymbol,
        side: "buy",
        quantity: params.trade.quantity,
        requestedPrice,
        filledPrice: requestedPrice,
        grossAmount,
        fees,
        slippage,
        netCashImpact: roundCurrency(-(grossAmount + fees + slippage)),
        rationale: params.trade.rationale,
        status: "filled",
        reason: null,
        requestedBySessionId: params.sessionId,
        createdAt: params.timestamp,
      },
    };
  }

  if (!position || position.quantity < params.trade.quantity) {
    return {
      portfolio: normalizeSnapshot(next, params.date),
      fill: rejectedFill({
        date: params.date,
        symbol: normalizedSymbol,
        side: "sell",
        quantity: params.trade.quantity,
        rationale: params.trade.rationale,
        sessionId: params.sessionId,
        createdAt: params.timestamp,
        reason: `Insufficient position to sell ${params.trade.quantity} shares of ${normalizedSymbol}.`,
      }),
    };
  }

  const netProceeds = roundCurrency(grossAmount - fees - slippage);
  next.cash = roundCurrency(next.cash + netProceeds);
  position.quantity -= params.trade.quantity;
  position.marketPrice = requestedPrice;
  position.marketValue = roundCurrency(position.quantity * requestedPrice);
  if (position.quantity <= 0) {
    next.positions = next.positions.filter((item) => item.symbol !== normalizedSymbol);
  }

  return {
    portfolio: normalizeSnapshot(next, params.date),
    fill: {
      date: params.date,
      symbol: normalizedSymbol,
      side: "sell",
      quantity: params.trade.quantity,
      requestedPrice,
      filledPrice: requestedPrice,
      grossAmount,
      fees,
      slippage,
      netCashImpact: netProceeds,
      rationale: params.trade.rationale,
      status: "filled",
      reason: null,
      requestedBySessionId: params.sessionId,
      createdAt: params.timestamp,
    },
  };
}

export function markPortfolioToMarket(params: {
  portfolio: PortfolioSnapshot;
  date: string;
  closePrices: Record<string, number | null>;
}): PortfolioSnapshot {
  const next = structuredClone(params.portfolio);
  next.positions = next.positions.map((position) => {
    const price = params.closePrices[position.symbol];
    if (!Number.isFinite(price)) {
      return { ...position };
    }
    const resolvedPrice = price as number;
    return {
      ...position,
      marketPrice: resolvedPrice,
      marketValue: roundCurrency(position.quantity * resolvedPrice),
    };
  });
  return normalizeSnapshot(next, params.date);
}

export function buildClosePriceMap(
  barsBySymbol: Record<string, BacktestHistoricalBar[]>,
  currentDate: string,
): Record<string, number | null> {
  return Object.fromEntries(
    Object.entries(barsBySymbol).map(([symbol, bars]) => {
      const bar = bars.find((item) => item.date === currentDate) ?? findLatestBarBefore(bars, currentDate);
      return [symbol, bar?.close ?? null];
    }),
  );
}

export function findBarForDate(
  barsBySymbol: Record<string, BacktestHistoricalBar[]>,
  symbol: string,
  date: string,
): BacktestHistoricalBar | null {
  return barsBySymbol[normalizeSymbol(symbol)]?.find((bar) => bar.date === date) ?? null;
}

function rejectedFill(params: {
  date: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  rationale: string;
  sessionId: string;
  createdAt: string;
  reason: string;
}): BacktestFillRecord {
  return {
    date: params.date,
    symbol: params.symbol,
    side: params.side,
    quantity: params.quantity,
    requestedPrice: 0,
    filledPrice: 0,
    grossAmount: 0,
    fees: 0,
    slippage: 0,
    netCashImpact: 0,
    rationale: params.rationale,
    status: "rejected",
    reason: params.reason,
    requestedBySessionId: params.sessionId,
    createdAt: params.createdAt,
  };
}

function normalizeSnapshot(snapshot: PortfolioSnapshot, updatedAt: string = snapshot.updatedAt): PortfolioSnapshot {
  const positions = snapshot.positions
    .filter((position) => position.quantity > 0)
    .map((position) => normalizePosition(position));
  const equity = roundCurrency(
    snapshot.cash +
      positions.reduce((sum, position) => sum + (position.marketValue ?? position.quantity * position.avgCost), 0),
  );
  return {
    ...snapshot,
    cash: roundCurrency(snapshot.cash),
    equity,
    buyingPower: roundCurrency(snapshot.cash),
    positions,
    openOrders: Array.isArray(snapshot.openOrders) ? snapshot.openOrders : [],
    updatedAt,
  };
}

function normalizePosition(position: Position): Position {
  const marketPrice = position.marketPrice ?? position.avgCost;
  const roundedPrice = marketPrice == null ? null : roundCurrency(marketPrice);
  return {
    ...position,
    symbol: normalizeSymbol(position.symbol),
    quantity: roundQuantity(position.quantity),
    avgCost: roundCurrency(position.avgCost),
    marketPrice: roundedPrice,
    marketValue:
      roundedPrice == null ? null : roundCurrency(roundQuantity(position.quantity) * roundedPrice),
    currency: position.currency || "USD",
  };
}

function findLatestBarBefore(bars: BacktestHistoricalBar[], date: string): BacktestHistoricalBar | null {
  for (let index = bars.length - 1; index >= 0; index -= 1) {
    const bar = bars[index];
    if (bar.date <= date) {
      return bar;
    }
  }
  return null;
}

export function normalizeSymbol(symbol: string): string {
  const trimmed = symbol.trim().toUpperCase().replace(/^\$/, "");
  return trimmed.includes(".") ? trimmed : `${trimmed}.US`;
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundQuantity(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
