import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { PortfolioSnapshot, Position } from "../types.js";

export class PortfolioStore {
  constructor(private readonly filePath: string = "data/portfolio.json") {}

  get path(): string {
    return path.resolve(this.filePath);
  }

  async load(): Promise<PortfolioSnapshot> {
    try {
      const raw = await readFile(this.path, "utf8");
      return normalizeLoadedSnapshot(JSON.parse(raw));
    } catch {
      const snapshot = this.defaultSnapshot();
      await this.save(snapshot);
      return snapshot;
    }
  }

  async save(snapshot: PortfolioSnapshot): Promise<void> {
    await mkdir(path.dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
  }

  defaultSnapshot(): PortfolioSnapshot {
    return {
      accountId: "default",
      mode: "paper",
      cash: 0,
      equity: null,
      buyingPower: null,
      positions: [],
      openOrders: [],
      updatedAt: "",
    };
  }

  async replace(snapshot: PortfolioSnapshot): Promise<PortfolioSnapshot> {
    const normalized = normalizeSnapshot(snapshot, {
      preserveEquity: snapshot.equity != null,
      preserveBuyingPower: snapshot.buyingPower != null,
    });
    await this.save(normalized);
    return normalized;
  }

  async patch(update: {
    accountId?: string;
    mode?: string;
    cash?: number;
    equity?: number | null;
    buyingPower?: number | null;
    positions?: Array<Partial<Position> & Pick<Position, "symbol" | "quantity">>;
    openOrders?: Array<Record<string, unknown>>;
    updatedAt?: string;
  }): Promise<PortfolioSnapshot> {
    const snapshot = await this.load();
    if (typeof update.accountId === "string" && update.accountId.trim()) {
      snapshot.accountId = update.accountId.trim();
    }
    if (typeof update.mode === "string" && update.mode.trim()) {
      snapshot.mode = update.mode.trim();
    }
    if (typeof update.cash === "number" && Number.isFinite(update.cash)) {
      snapshot.cash = update.cash;
    }
    if (update.equity === null || (typeof update.equity === "number" && Number.isFinite(update.equity))) {
      snapshot.equity = update.equity;
    }
    if (
      update.buyingPower === null ||
      (typeof update.buyingPower === "number" && Number.isFinite(update.buyingPower))
    ) {
      snapshot.buyingPower = update.buyingPower;
    }
    if (Array.isArray(update.openOrders)) {
      snapshot.openOrders = update.openOrders;
    }
    if (Array.isArray(update.positions)) {
      for (const patch of update.positions) {
        const symbol = patch.symbol.trim().toUpperCase();
        const existing = snapshot.positions.find((position) => position.symbol === symbol);
        if (patch.quantity <= 0) {
          snapshot.positions = snapshot.positions.filter((position) => position.symbol !== symbol);
          continue;
        }
        const next: Position = {
          symbol,
          quantity: patch.quantity,
          avgCost: numericOr(existing?.avgCost, patch.avgCost, 0),
          marketPrice: nullableNumericOr(existing?.marketPrice, patch.marketPrice, null),
          marketValue: nullableNumericOr(
            existing?.marketValue,
            patch.marketValue,
            nullableProduct(
              patch.quantity,
              nullableNumericOr(existing?.marketPrice, patch.marketPrice, null),
            ),
          ),
          currency:
            (typeof patch.currency === "string" && patch.currency.trim()) ||
            existing?.currency ||
            "USD",
        };
        if (existing) {
          Object.assign(existing, next);
        } else {
          snapshot.positions.push(next);
        }
      }
    }
    const normalized = normalizeSnapshot(snapshot, {
      preserveEquity: update.equity !== undefined,
      preserveBuyingPower: update.buyingPower !== undefined,
    });
    normalized.updatedAt = update.updatedAt ?? new Date().toISOString();
    await this.save(normalized);
    return normalized;
  }

  async applyFill(params: {
    symbol: string;
    side: "buy" | "sell";
    quantity: number;
    price: number;
    timestamp: string;
    currency?: string;
  }): Promise<PortfolioSnapshot> {
    const snapshot = await this.load();
    const existing = snapshot.positions.find((position) => position.symbol === params.symbol);
    if (params.side === "buy") {
      snapshot.cash -= params.quantity * params.price;
      if (!existing) {
        snapshot.positions.push({
          symbol: params.symbol,
          quantity: params.quantity,
          avgCost: params.price,
          marketPrice: params.price,
          marketValue: params.quantity * params.price,
          currency: params.currency ?? "USD",
        });
      } else {
        const totalQty = existing.quantity + params.quantity;
        const totalCost = existing.quantity * existing.avgCost + params.quantity * params.price;
        existing.quantity = totalQty;
        existing.avgCost = totalCost / totalQty;
        existing.marketPrice = params.price;
        existing.marketValue = totalQty * params.price;
      }
    } else {
      if (!existing || existing.quantity < params.quantity) {
        throw new Error(`Cannot sell ${params.quantity} shares of ${params.symbol}; position is insufficient.`);
      }
      snapshot.cash += params.quantity * params.price;
      existing.quantity -= params.quantity;
      existing.marketPrice = params.price;
      existing.marketValue = existing.quantity * params.price;
      if (existing.quantity === 0) {
        snapshot.positions = snapshot.positions.filter((position) => position.symbol !== params.symbol);
      }
    }
    const normalized = normalizeSnapshot(snapshot, {
      preserveEquity: false,
      preserveBuyingPower: false,
    });
    normalized.updatedAt = params.timestamp;
    await this.save(normalized);
    return normalized;
  }
}

function normalizeSnapshot(
  snapshot: PortfolioSnapshot,
  options: { preserveEquity: boolean; preserveBuyingPower: boolean },
): PortfolioSnapshot {
  const normalizedPositions = snapshot.positions.map((position) => {
    const marketPrice = position.marketPrice ?? position.avgCost ?? null;
    const marketValue =
      position.marketValue ??
      (marketPrice == null ? null : roundCurrency(position.quantity * marketPrice));
    return {
      ...position,
      marketPrice,
      marketValue,
    };
  });
  const marketValueTotal = normalizedPositions.reduce((sum, position) => {
    return sum + (position.marketValue ?? 0);
  }, 0);
  return {
    ...snapshot,
    positions: normalizedPositions,
    equity: options.preserveEquity
      ? snapshot.equity
      : roundCurrency(snapshot.cash + marketValueTotal),
    buyingPower: options.preserveBuyingPower
      ? snapshot.buyingPower
      : roundCurrency(snapshot.cash),
  };
}

function normalizeLoadedSnapshot(snapshot: unknown): PortfolioSnapshot {
  const base = {
    accountId: "default",
    mode: "paper",
    cash: 0,
    equity: null,
    buyingPower: null,
    positions: [],
    openOrders: [],
    updatedAt: "",
    ...(snapshot && typeof snapshot === "object" ? snapshot : {}),
  } as PortfolioSnapshot;

  return normalizeSnapshot(
    {
      ...base,
      positions: Array.isArray(base.positions) ? base.positions : [],
      openOrders: Array.isArray(base.openOrders) ? base.openOrders : [],
      updatedAt: typeof base.updatedAt === "string" ? base.updatedAt : "",
    },
    {
      preserveEquity: base.equity != null,
      preserveBuyingPower: base.buyingPower != null,
    },
  );
}

function numericOr(...values: Array<number | undefined>): number {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return 0;
}

function nullableNumericOr(...values: Array<number | null | undefined>): number | null {
  for (const value of values) {
    if (value === null) {
      return null;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function nullableProduct(quantity: number, price: number | null): number | null {
  if (!Number.isFinite(quantity) || price == null) {
    return null;
  }
  return roundCurrency(quantity * price);
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
