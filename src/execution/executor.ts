import { AuditLogger } from "../audit/logger.js";
import { MemoryService } from "../memory/service.js";
import { buildPortfolioSummary } from "../memory/summary.js";
import type { QuoteResolutionRequest, QuoteResolverService, ResolvedMarketQuote } from "../market/quote-resolver.js";
import { normalizeSymbol } from "../market/symbols.js";
import { PortfolioStore } from "../portfolio/store.js";
import type { PortfolioSnapshot, TradeExecutionResult, TradeIntent } from "../types.js";

export class TradeExecutor {
  constructor(
    private readonly portfolioStore: PortfolioStore,
    private readonly quotes: QuoteResolverService,
    private readonly memory: MemoryService,
    private readonly audit: AuditLogger,
  ) {}

  async execute(
    intent: TradeIntent,
    resolution: Omit<QuoteResolutionRequest, "symbol" | "purpose"> & { purpose?: string } = {
      sessionId: "system:trade-executor",
      rootUserMessage: "Resolve a live quote for direct paper-trade execution.",
    },
  ): Promise<TradeExecutionResult> {
    const normalizedSymbol = normalizeSymbol(intent.symbol);
    const quote = await this.quotes.resolveQuote({
      sessionId: resolution.sessionId,
      rootUserMessage: resolution.rootUserMessage,
      symbol: normalizedSymbol,
      purpose: resolution.purpose?.trim() || `Resolve a live executable quote for a paper ${intent.side}.`,
    });
    const marketPrice = quote.price;

    const fillPrice = resolveFillPrice(intent, marketPrice);
    if (fillPrice == null) {
      return this.reject(intent, normalizedSymbol, `Limit conditions were not met for ${intent.side} ${normalizedSymbol}.`);
    }

    const snapshot = await this.portfolioStore.load();
    if (intent.side === "buy" && snapshot.cash < fillPrice * intent.quantity) {
      return this.reject(intent, normalizedSymbol, `Insufficient cash to buy ${intent.quantity} shares of ${normalizedSymbol}.`);
    }
    if (intent.side === "sell") {
      const position = snapshot.positions.find((item) => item.symbol === normalizedSymbol);
      if (!position || position.quantity < intent.quantity) {
        return this.reject(intent, normalizedSymbol, `Insufficient position to sell ${intent.quantity} shares of ${normalizedSymbol}.`);
      }
    }

    const nextSnapshot = await this.portfolioStore.applyFill({
      symbol: normalizedSymbol,
      side: intent.side,
      quantity: intent.quantity,
      price: fillPrice,
      timestamp: new Date().toISOString(),
      currency: "USD",
    });
    await this.writePortfolioSummary(nextSnapshot);
    await this.audit.append({
      type: "paper_trade",
      timestamp: new Date().toISOString(),
      symbol: normalizedSymbol,
      side: intent.side,
      quantity: intent.quantity,
      price: fillPrice,
      orderType: intent.orderType,
      limitPrice: intent.limitPrice,
      rationale: intent.rationale,
      quote: buildQuoteAuditDetails(quote),
    });

    return {
      status: "filled",
      mode: "paper",
      symbol: normalizedSymbol,
      side: intent.side,
      quantity: intent.quantity,
      price: fillPrice,
      message: `Paper order filled at ${fillPrice.toFixed(2)} USD using ${quote.field} from ${quote.providerName}/${quote.toolName}.`,
      snapshot: nextSnapshot,
    };
  }

  async replacePortfolio(snapshot: PortfolioSnapshot): Promise<PortfolioSnapshot> {
    const saved = await this.portfolioStore.replace(snapshot);
    await this.writePortfolioSummary(saved);
    return saved;
  }

  private async writePortfolioSummary(snapshot: PortfolioSnapshot): Promise<void> {
    await this.memory.writeDocument("portfolio/summary.md", buildPortfolioSummary(snapshot));
  }

  private async reject(intent: TradeIntent, normalizedSymbol: string, reason: string): Promise<TradeExecutionResult> {
    const snapshot = await this.portfolioStore.load();
    await this.audit.append({
      type: "paper_trade_rejected",
      timestamp: new Date().toISOString(),
      symbol: normalizedSymbol,
      side: intent.side,
      quantity: intent.quantity,
      orderType: intent.orderType,
      limitPrice: intent.limitPrice,
      rationale: intent.rationale,
      reason,
    });
    return {
      status: "rejected",
      mode: "paper",
      symbol: normalizedSymbol,
      side: intent.side,
      quantity: intent.quantity,
      price: null,
      message: reason,
      snapshot,
    };
  }
}

function buildQuoteAuditDetails(quote: ResolvedMarketQuote): Record<string, unknown> {
  return {
    symbol: quote.symbol,
    price: quote.price,
    field: quote.field,
    timestamp: quote.timestamp,
    currency: quote.currency,
    providerType: quote.providerType,
    providerName: quote.providerName,
    toolName: quote.toolName,
    warnings: [...quote.warnings],
    resolutionSessionId: quote.resolutionSessionId,
  };
}

function resolveFillPrice(intent: TradeIntent, marketPrice: number): number | null {
  if (intent.orderType === "market") {
    return marketPrice;
  }
  if (intent.limitPrice == null) {
    return null;
  }
  if (intent.side === "buy") {
    return marketPrice <= intent.limitPrice ? marketPrice : null;
  }
  return marketPrice >= intent.limitPrice ? marketPrice : null;
}
