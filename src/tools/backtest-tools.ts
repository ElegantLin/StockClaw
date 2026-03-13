import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";

import type { ToolExecutionContext, ToolRegistryDeps } from "./contracts.js";
import { jsonToolResult, optionalNumber, readObject, requiredNumber, requiredString } from "./support.js";

export function createBacktestTools(
  deps: ToolRegistryDeps,
  context: ToolExecutionContext,
): ToolDefinition[] {
  return [
    {
      name: "backtest_prepare_dataset",
      label: "Backtest Prepare Dataset",
      description:
        "Prepare a frozen historical dataset for backtesting. This discovers a usable historical-market-data MCP provider, fetches the date range, and stores the dataset for deterministic execution.",
      parameters: Type.Object({
        kind: Type.String({ enum: ["asset", "portfolio", "current_portfolio"] as never }),
        symbol: Type.Optional(Type.String()),
        dateFrom: Type.String(),
        dateTo: Type.String(),
        initialCash: Type.Optional(Type.Number()),
        cash: Type.Optional(Type.Number()),
        positions: Type.Optional(
          Type.Array(
            Type.Object({
              symbol: Type.String(),
              quantity: Type.Number(),
              avgCost: Type.Optional(Type.Number()),
              marketPrice: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
              marketValue: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
              currency: Type.Optional(Type.String()),
            }),
          ),
        ),
        feesBps: Type.Optional(Type.Number()),
        slippageBps: Type.Optional(Type.Number()),
        spawnSpecialists: Type.Optional(Type.Boolean()),
      }),
      execute: async (_toolCallId, raw) => {
        const kind = requiredString(raw, "kind");
        if (kind === "asset") {
          return jsonToolResult(
            await deps.backtests.prepareAsset(
              {
                symbol: requiredString(raw, "symbol"),
                dateFrom: requiredString(raw, "dateFrom"),
                dateTo: requiredString(raw, "dateTo"),
                initialCash: requiredNumber(raw, "initialCash"),
                feesBps: optionalNumber(raw, "feesBps") ?? undefined,
                slippageBps: optionalNumber(raw, "slippageBps") ?? undefined,
                spawnSpecialists: readBoolean(raw, "spawnSpecialists"),
              },
              { sessionId: context.sessionKey, rootUserMessage: context.rootUserMessage || "" },
            ),
          );
        }
        if (kind === "portfolio") {
          const positions = readPositions(raw, "positions");
          return jsonToolResult(
            await deps.backtests.preparePortfolio(
              {
                dateFrom: requiredString(raw, "dateFrom"),
                dateTo: requiredString(raw, "dateTo"),
                cash: requiredNumber(raw, "cash"),
                positions,
                feesBps: optionalNumber(raw, "feesBps") ?? undefined,
                slippageBps: optionalNumber(raw, "slippageBps") ?? undefined,
                spawnSpecialists: readBoolean(raw, "spawnSpecialists"),
              },
              { sessionId: context.sessionKey, rootUserMessage: context.rootUserMessage || "" },
            ),
          );
        }
        if (kind === "current_portfolio") {
          return jsonToolResult(
            await deps.backtests.prepareCurrentPortfolio(
              {
                dateFrom: requiredString(raw, "dateFrom"),
                dateTo: requiredString(raw, "dateTo"),
                feesBps: optionalNumber(raw, "feesBps") ?? undefined,
                slippageBps: optionalNumber(raw, "slippageBps") ?? undefined,
                spawnSpecialists: readBoolean(raw, "spawnSpecialists"),
              },
              { sessionId: context.sessionKey, rootUserMessage: context.rootUserMessage || "" },
            ),
          );
        }
        throw new Error(`Unsupported backtest dataset kind '${kind}'.`);
      },
    },
    {
      name: "backtest_run_dataset",
      label: "Backtest Run Dataset",
      description:
        "Run a previously prepared backtest dataset. Returns only the final structured result so the main session does not need to process internal backtest steps.",
      parameters: Type.Object({
        runId: Type.String(),
      }),
      execute: async (_toolCallId, raw) => jsonToolResult(await deps.backtests.runDataset(requiredString(raw, "runId"))),
    },
    {
      name: "backtest_asset",
      label: "Backtest Asset",
      description:
        "Queue an end-to-end single-asset backtest. The run continues in the background and the final result is delivered back to the originating session when it completes.",
      parameters: Type.Object({
        symbol: Type.String(),
        dateFrom: Type.String(),
        dateTo: Type.String(),
        initialCash: Type.Number(),
        feesBps: Type.Optional(Type.Number()),
        slippageBps: Type.Optional(Type.Number()),
        spawnSpecialists: Type.Optional(Type.Boolean()),
      }),
      execute: async (_toolCallId, raw) =>
        jsonToolResult(
          await deps.backtests.submitAssetJob(
            {
              symbol: requiredString(raw, "symbol"),
              dateFrom: requiredString(raw, "dateFrom"),
              dateTo: requiredString(raw, "dateTo"),
              initialCash: requiredNumber(raw, "initialCash"),
              feesBps: optionalNumber(raw, "feesBps") ?? undefined,
              slippageBps: optionalNumber(raw, "slippageBps") ?? undefined,
              spawnSpecialists: readBoolean(raw, "spawnSpecialists"),
            },
            { sessionId: context.sessionKey, requestId: context.requestId, rootUserMessage: context.rootUserMessage || "" },
          ),
        ),
    },
    {
      name: "backtest_portfolio",
      label: "Backtest Portfolio",
      description:
        "Queue an end-to-end portfolio backtest from explicit positions and cash. The run continues in the background and the final result is delivered back to the originating session.",
      parameters: Type.Object({
        dateFrom: Type.String(),
        dateTo: Type.String(),
        cash: Type.Number(),
        positions: Type.Array(
          Type.Object({
            symbol: Type.String(),
            quantity: Type.Number(),
            avgCost: Type.Optional(Type.Number()),
            marketPrice: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
            marketValue: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
            currency: Type.Optional(Type.String()),
          }),
        ),
        feesBps: Type.Optional(Type.Number()),
        slippageBps: Type.Optional(Type.Number()),
        spawnSpecialists: Type.Optional(Type.Boolean()),
      }),
      execute: async (_toolCallId, raw) =>
        jsonToolResult(
          await deps.backtests.submitPortfolioJob(
            {
              dateFrom: requiredString(raw, "dateFrom"),
              dateTo: requiredString(raw, "dateTo"),
              cash: requiredNumber(raw, "cash"),
              positions: readPositions(raw, "positions"),
              feesBps: optionalNumber(raw, "feesBps") ?? undefined,
              slippageBps: optionalNumber(raw, "slippageBps") ?? undefined,
              spawnSpecialists: readBoolean(raw, "spawnSpecialists"),
            },
            { sessionId: context.sessionKey, requestId: context.requestId, rootUserMessage: context.rootUserMessage || "" },
          ),
        ),
    },
    {
      name: "backtest_current_portfolio",
      label: "Backtest Current Portfolio",
      description:
        "Queue an end-to-end backtest starting from the current paper portfolio snapshot. The current portfolio is frozen at submission time and the final result is delivered back to the originating session.",
      parameters: Type.Object({
        dateFrom: Type.String(),
        dateTo: Type.String(),
        feesBps: Type.Optional(Type.Number()),
        slippageBps: Type.Optional(Type.Number()),
        spawnSpecialists: Type.Optional(Type.Boolean()),
      }),
      execute: async (_toolCallId, raw) =>
        jsonToolResult(
          await deps.backtests.submitCurrentPortfolioJob(
            {
              dateFrom: requiredString(raw, "dateFrom"),
              dateTo: requiredString(raw, "dateTo"),
              feesBps: optionalNumber(raw, "feesBps") ?? undefined,
              slippageBps: optionalNumber(raw, "slippageBps") ?? undefined,
              spawnSpecialists: readBoolean(raw, "spawnSpecialists"),
            },
            { sessionId: context.sessionKey, requestId: context.requestId, rootUserMessage: context.rootUserMessage || "" },
          ),
        ),
    },
  ];
}

function readPositions(raw: unknown, key: string) {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>)[key] : undefined;
  if (!Array.isArray(value)) {
    throw new Error(`Missing required array parameter '${key}'.`);
  }
  return value.map((entry) => {
    const record = entry && typeof entry === "object" && !Array.isArray(entry)
      ? (entry as Record<string, unknown>)
      : {};
    return {
      symbol: requiredString(record, "symbol"),
      quantity: requiredNumber(record, "quantity"),
      avgCost: optionalNumber(record, "avgCost") ?? undefined,
      marketPrice: readNullableNumber(record, "marketPrice"),
      marketValue: readNullableNumber(record, "marketValue"),
      currency: readOptionalString(record, "currency"),
    };
  });
}

function readNullableNumber(raw: unknown, key: string): number | null | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const value = (raw as Record<string, unknown>)[key];
  if (value === null) {
    return null;
  }
  const numeric = optionalNumber(raw, key);
  return numeric ?? undefined;
}

function readOptionalString(raw: unknown, key: string): string | undefined {
  const record = readObject({ value: raw }, "value");
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readBoolean(raw: unknown, key: string): boolean | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const value = (raw as Record<string, unknown>)[key];
  return typeof value === "boolean" ? value : undefined;
}
