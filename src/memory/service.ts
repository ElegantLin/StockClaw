import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import type { MemoryArtifact, MemorySearchResult } from "../types.js";

export interface MemoryDocument {
  category: string;
  path: string;
  content: string;
}

export class MemoryService {
  constructor(public readonly root: string = "memory") {}

  async readCategory(category: string): Promise<MemoryDocument[]> {
    const directory = path.resolve(this.root, category);
    try {
      const entries = await readdir(directory, { withFileTypes: true });
      const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".md"));
      const docs = await Promise.all(
        files.map(async (entry) => {
          const absolute = path.join(directory, entry.name);
          return {
            category,
            path: absolute,
            content: await readFile(absolute, "utf8"),
          } satisfies MemoryDocument;
        }),
      );
      return docs.sort((left, right) => left.path.localeCompare(right.path));
    } catch {
      return [];
    }
  }

  async writeDocument(relativePath: string, content: string): Promise<void> {
    const target = path.resolve(this.root, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content.trimEnd() + "\n", "utf8");
  }

  async readDocument(relativePath: string): Promise<string | null> {
    const normalized = relativePath.replace(/\\/g, "/").replace(/^memory\//, "");
    const target = path.resolve(this.root, normalized);
    if (!target.startsWith(path.resolve(this.root))) {
      throw new Error("memory read path must stay inside the memory root.");
    }
    try {
      return await readFile(target, "utf8");
    } catch {
      return null;
    }
  }

  async deleteDocument(relativePath: string): Promise<void> {
    const normalized = relativePath.replace(/\\/g, "/").replace(/^memory\//, "");
    const target = path.resolve(this.root, normalized);
    if (!target.startsWith(path.resolve(this.root))) {
      throw new Error("memory delete path must stay inside the memory root.");
    }
    try {
      await unlink(target);
    } catch {
      // Ignore missing files during cleanup.
    }
  }

  async appendDocument(relativePath: string, heading: string, entries: string[]): Promise<void> {
    const target = path.resolve(this.root, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    let existing = "";
    try {
      existing = await readFile(target, "utf8");
    } catch {
      existing = "";
    }
    const timestamp = new Date().toISOString();
    const block = [`## ${heading} ${timestamp}`, "", ...entries.map((entry) => `- ${entry}`), ""].join("\n");
    const next = [existing.trim(), block.trim()].filter(Boolean).join("\n\n") + "\n";
    await writeFile(target, next, "utf8");
  }

  async search(params: {
    query: string;
    maxResults?: number;
    minScore?: number;
  }): Promise<MemorySearchResult[]> {
    const query = params.query.trim();
    if (!query) {
      return [];
    }

    const results: MemorySearchResult[] = [];
    const docs = await this.readAllMarkdownDocuments();
    const maxResults = Math.max(1, Math.floor(params.maxResults ?? 5));
    const minScore = typeof params.minScore === "number" ? params.minScore : 0.25;

    for (const doc of docs) {
      const lines = doc.content.split(/\r?\n/);
      const matches = scoreDocumentMatches(doc.path, lines, query);
      for (const match of matches) {
        if (match.score < minScore) {
          continue;
        }
        results.push(match);
      }
    }

    return results
      .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
      .slice(0, maxResults);
  }

  async readSnippet(params: {
    relativePath: string;
    from?: number;
    lines?: number;
  }): Promise<{ path: string; from: number; lines: number; text: string } | null> {
    const resolved = resolveMemoryLookupReference(this.root, params.relativePath);
    if (!resolved) {
      return null;
    }

    const target = path.resolve(this.root, resolved.relativePath);

    let content: string;
    try {
      content = await readFile(target, "utf8");
    } catch {
      return null;
    }

    const allLines = content.split(/\r?\n/);
    const from = Math.max(1, Math.floor(params.from ?? resolved.from ?? 1));
    const parsedLines =
      params.lines ??
      resolved.lines ??
      Math.min(40, allLines.length);
    const lineCount = Math.max(1, Math.floor(parsedLines));
    const slice = allLines.slice(from - 1, from - 1 + lineCount).join("\n").trimEnd();
    return {
      path: path.relative(rootDir(), target).replaceAll("\\", "/"),
      from,
      lines: lineCount,
      text: slice,
    };
  }

  async listRecentArtifacts(limit = 8): Promise<MemoryArtifact[]> {
    const root = path.resolve(this.root);
    const artifacts: MemoryArtifact[] = [];
    await this.collectRecentArtifacts(root, root, artifacts);
    return artifacts
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, limit);
  }

  private async collectRecentArtifacts(
    root: string,
    directory: string,
    artifacts: MemoryArtifact[],
  ): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await this.collectRecentArtifacts(root, absolute, artifacts);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".md")) {
        continue;
      }
      const [content, details] = await Promise.all([
        readFile(absolute, "utf8"),
        stat(absolute),
      ]);
      artifacts.push({
        path: path.relative(rootDir(), absolute).replaceAll("\\", "/"),
        fileName: entry.name,
        category: classifyMemoryArtifact(path.relative(root, absolute).replaceAll("\\", "/")),
        updatedAt: details.mtime.toISOString(),
        excerpt: content.trim().slice(0, 240),
      });
    }
  }

  private async readAllMarkdownDocuments(): Promise<MemoryDocument[]> {
    const root = path.resolve(this.root);
    const docs: MemoryDocument[] = [];
    await this.collectDocuments(root, root, docs);
    return docs;
  }

  private async collectDocuments(root: string, directory: string, docs: MemoryDocument[]): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await this.collectDocuments(root, absolute, docs);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".md")) {
        continue;
      }
      docs.push({
        category: classifyPathCategory(path.relative(root, absolute).replaceAll("\\", "/")),
        path: absolute,
        content: await readFile(absolute, "utf8"),
      });
    }
  }
}

function classifyMemoryArtifact(relativePath: string): MemoryArtifact["category"] {
  if (/^\d{4}-\d{2}-\d{2}\.md$/.test(relativePath)) {
    return "daily";
  }
  if (/^\d{4}-\d{2}-\d{2}-.+\.md$/.test(relativePath)) {
    return "archive";
  }
  if (
    relativePath === "non-investment/SOUL.md" ||
    relativePath === "non-investment/USER.md" ||
    relativePath === "non-investment/TOOLS.md" ||
    relativePath === "knowledge/INVESTMENT-PRINCIPLES.md"
  ) {
    return "bootstrap";
  }
  if (relativePath.startsWith("knowledge/")) {
    return "knowledge";
  }
  if (relativePath.startsWith("portfolio/")) {
    return "portfolio";
  }
  return "other";
}

function rootDir(): string {
  return path.resolve(".");
}

function resolveMemoryLookupReference(
  memoryRoot: string,
  rawReference: string,
): { relativePath: string; from?: number; lines?: number } | null {
  const trimmed = String(rawReference || "").trim();
  if (!trimmed) {
    return null;
  }

  const { pathPart, from, lines } = parseCitation(trimmed);
  const normalizedSlashes = pathPart.replace(/\\/g, "/").replace(/^memory\//i, "").replace(/^\/+/, "");

  const root = path.resolve(memoryRoot);
  let relativePath = normalizedSlashes;

  if (looksLikeAbsolutePath(pathPart)) {
    const absolute = path.resolve(pathPart);
    const relative = path.relative(root, absolute);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      return null;
    }
    relativePath = relative.replace(/\\/g, "/");
  }

  const normalizedRelative = path.posix.normalize(relativePath);
  if (
    !normalizedRelative ||
    normalizedRelative === "." ||
    normalizedRelative.startsWith("../") ||
    normalizedRelative === ".."
  ) {
    return null;
  }

  const target = path.resolve(root, normalizedRelative);
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return {
    relativePath: relative.replace(/\\/g, "/"),
    from,
    lines,
  };
}

function parseCitation(reference: string): { pathPart: string; from?: number; lines?: number } {
  const match = reference.match(/^(.*?)(?:#L(\d+)(?:-L?(\d+))?)?$/i);
  if (!match) {
    return { pathPart: reference };
  }

  const pathPart = (match[1] || reference).trim();
  const from = match[2] ? Number(match[2]) : undefined;
  const to = match[3] ? Number(match[3]) : undefined;
  const lines = from && to && to >= from ? to - from + 1 : undefined;
  return { pathPart, from, lines };
}

function looksLikeAbsolutePath(value: string): boolean {
  return (
    path.isAbsolute(value) ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.startsWith("\\\\")
  );
}

function classifyPathCategory(relativePath: string): string {
  const parts = relativePath.split(/[\\/]/).filter(Boolean);
  return parts[0] || "other";
}

function scoreDocumentMatches(pathname: string, lines: string[], query: string): MemorySearchResult[] {
  const loweredQuery = query.toLowerCase();
  const tokens = loweredQuery
    .split(/[\s,.;:()]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
  const results: MemorySearchResult[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const loweredLine = line.toLowerCase();
    let score = 0;
    if (loweredLine.includes(loweredQuery)) {
      score += 1.5;
    }
    for (const token of tokens) {
      if (loweredLine.includes(token)) {
        score += 0.45;
      }
    }
    if (score <= 0) {
      continue;
    }

    const start = Math.max(0, index - 2);
    const end = Math.min(lines.length, index + 3);
    const snippet = lines.slice(start, end).join("\n").trim();
    results.push({
      path: path.relative(rootDir(), pathname).replaceAll("\\", "/"),
      startLine: start + 1,
      endLine: end,
      score: Number(score.toFixed(2)),
      snippet,
      citation: `${path.relative(rootDir(), pathname).replaceAll("\\", "/")}#L${start + 1}-L${end}`,
    });
  }

  return collapseOverlappingMatches(results);
}

function collapseOverlappingMatches(results: MemorySearchResult[]): MemorySearchResult[] {
  const sorted = [...results].sort(
    (left, right) =>
      left.path.localeCompare(right.path) || left.startLine - right.startLine || right.score - left.score,
  );
  const merged: MemorySearchResult[] = [];
  for (const item of sorted) {
    const last = merged.at(-1);
    if (last && last.path === item.path && item.startLine <= last.endLine) {
      if (item.score > last.score) {
        merged[merged.length - 1] = item;
      }
      continue;
    }
    merged.push(item);
  }
  return merged;
}
