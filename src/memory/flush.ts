export const MEMORY_FLUSH_SKIP_TOKEN = "NO_MEMORY_FLUSH";

export function resolveMemoryFlushDate(timestamp?: string): string {
  return (timestamp ?? new Date().toISOString()).slice(0, 10);
}

export function resolveMemoryFlushPrompt(markdown: string, timestamp?: string): string {
  return markdown.replaceAll("YYYY-MM-DD", resolveMemoryFlushDate(timestamp)).trim();
}
