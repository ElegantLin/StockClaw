import type { AppSessionRecord } from "../types.js";

export interface ContextUsageSnapshot {
  contextTokens: number;
  contextWindow: number;
  remainingTokens: number;
  percentUsed: number;
  compactionThresholdTokens: number;
}

export function resolveSessionContextUsage(
  session: Pick<AppSessionRecord, "lastUsage">,
  contextWindow: number,
  compactionThresholdTokens: number,
): ContextUsageSnapshot | null {
  if (session.lastUsage?.contextTokens && session.lastUsage.contextTokens > 0) {
    const remainingTokens = Math.max(0, contextWindow - session.lastUsage.contextTokens);
    return {
      contextTokens: session.lastUsage.contextTokens,
      contextWindow,
      remainingTokens,
      percentUsed: Math.min(100, Math.round((session.lastUsage.contextTokens / Math.max(1, contextWindow)) * 100)),
      compactionThresholdTokens,
    };
  }
  return null;
}
