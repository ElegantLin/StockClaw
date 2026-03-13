import type { AppSessionRecord } from "../types.js";

export interface ContextUsageSnapshot {
  contextTokens: number;
  source: "provider" | "estimate";
  contextWindow: number;
  remainingTokens: number;
  percentUsed: number;
  compactionThresholdTokens: number;
}

export function estimateSessionContextUsage(
  session: Pick<AppSessionRecord, "transcript" | "sessionSummary">,
  contextWindow: number,
  compactionThresholdTokens: number,
): ContextUsageSnapshot {
  const transcriptChars = session.transcript.reduce((sum, entry) => sum + entry.content.length, 0);
  const summaryChars = session.sessionSummary?.length ?? 0;
  const contextTokens = Math.max(1, Math.floor((transcriptChars + summaryChars) / 4));
  const remainingTokens = Math.max(0, contextWindow - contextTokens);
  const percentUsed = Math.min(100, Math.round((contextTokens / Math.max(1, contextWindow)) * 100));
  return {
    contextTokens,
    source: "estimate",
    contextWindow,
    remainingTokens,
    percentUsed,
    compactionThresholdTokens,
  };
}

export function resolveSessionContextUsage(
  session: Pick<AppSessionRecord, "transcript" | "sessionSummary" | "lastUsage">,
  contextWindow: number,
  compactionThresholdTokens: number,
): ContextUsageSnapshot {
  if (session.lastUsage?.contextTokens && session.lastUsage.contextTokens > 0) {
    const remainingTokens = Math.max(0, contextWindow - session.lastUsage.contextTokens);
    return {
      contextTokens: session.lastUsage.contextTokens,
      source: "provider",
      contextWindow,
      remainingTokens,
      percentUsed: Math.min(100, Math.round((session.lastUsage.contextTokens / Math.max(1, contextWindow)) * 100)),
      compactionThresholdTokens,
    };
  }
  return estimateSessionContextUsage(session, contextWindow, compactionThresholdTokens);
}
