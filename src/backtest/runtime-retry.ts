import type { BacktestTraceSink } from "./artifacts.js";

const DEFAULT_MAX_ATTEMPTS = 3;
const RETRYABLE_PATTERNS = [
  "network_error",
  "rate_limit",
  "timed out",
  "timeout",
  "econnreset",
  "socket hang up",
  "temporarily unavailable",
];

export async function runWithBacktestTransientRetry<T>(params: {
  operation: string;
  sessionId: string;
  trace?: BacktestTraceSink | null;
  maxAttempts?: number;
  run(attempt: number): Promise<T>;
}): Promise<T> {
  const maxAttempts = Math.max(1, params.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await params.run(attempt);
    } catch (error) {
      lastError = error;
      if (!isRetryableBacktestError(error) || attempt >= maxAttempts) {
        throw error;
      }
      const delayMs = retryDelayMs(attempt);
      await params.trace?.log({
        level: "warn",
        type: "transient_retry_scheduled",
        data: {
          operation: params.operation,
          sessionId: params.sessionId,
          attempt,
          nextAttempt: attempt + 1,
          maxAttempts,
          delayMs,
          error: errorMessage(error),
        },
      });
      await sleep(delayMs);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(errorMessage(lastError));
}

function isRetryableBacktestError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  return RETRYABLE_PATTERNS.some((pattern) => message.includes(pattern));
}

function retryDelayMs(attempt: number): number {
  return Math.min(5_000, 1_000 * attempt);
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return String(error || "unknown error");
}
