import type { MemoryService } from "./service.js";

export const ROOT_BOOTSTRAP_MEMORY_FILES = [
  "non-investment/SOUL.md",
  "non-investment/USER.md",
  "non-investment/TOOLS.md",
  "knowledge/INVESTMENT-PRINCIPLES.md",
] as const;

export const DURABLE_MEMORY_CATEGORIES = ["non-investment", "knowledge", "portfolio"] as const;

const LEGACY_MEMORY_MIGRATIONS = [
  { from: "user/profile.md", to: "non-investment/USER.md" },
  { from: "knowledge/investment-principles.md", to: "knowledge/INVESTMENT-PRINCIPLES.md" },
] as const;

export interface BootstrapMemoryFile {
  relativePath: string;
  content: string;
}

export async function ensureBootstrapMemoryFiles(memory: MemoryService): Promise<void> {
  for (const migration of LEGACY_MEMORY_MIGRATIONS) {
    await migrateLegacyMemoryFile(memory, migration.from, migration.to);
  }
  for (const relativePath of ROOT_BOOTSTRAP_MEMORY_FILES) {
    const existing = await memory.readDocument(relativePath);
    if (existing == null) {
      await memory.writeDocument(relativePath, "");
    }
  }
}

export async function loadBootstrapMemoryFiles(memory: MemoryService): Promise<BootstrapMemoryFile[]> {
  const files = await Promise.all(
    ROOT_BOOTSTRAP_MEMORY_FILES.map(async (relativePath) => ({
      relativePath,
      content: (await memory.readDocument(relativePath)) ?? "",
    })),
  );
  return files;
}

export function renderBootstrapMemoryPrompt(files: BootstrapMemoryFile[]): string {
  const rendered = files
    .map((file) => `## memory/${file.relativePath}\n\n${file.content.trim() || "(empty)"}`)
    .join("\n\n");
  return [
    "User-writable bootstrap memory files are loaded below.",
    "Treat them as durable high-priority context.",
    "They are not system prompt files under prompts/ and may be updated through chat.",
    "",
    rendered,
  ].join("\n");
}

async function migrateLegacyMemoryFile(memory: MemoryService, from: string, to: string): Promise<void> {
  const legacy = (await memory.readDocument(from))?.trim();
  if (!legacy) {
    await memory.deleteDocument(from);
    return;
  }
  if (from.toLowerCase() === to.toLowerCase()) {
    await memory.writeDocument(to, legacy);
    return;
  }
  const current = (await memory.readDocument(to)) ?? "";
  const currentTrimmed = current.trim();

  if (!currentTrimmed) {
    await memory.writeDocument(to, legacy);
    await memory.deleteDocument(from);
    return;
  }

  if (!current.includes(legacy)) {
    await memory.writeDocument(to, `${currentTrimmed}\n\n${legacy}`);
  }
  await memory.deleteDocument(from);
}
