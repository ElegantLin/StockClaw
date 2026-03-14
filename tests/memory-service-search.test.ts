import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { MemoryService } from "../src/memory/service.js";

describe("MemoryService search and snippet reads", () => {
  it("finds durable memory snippets and reads focused ranges", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "stock-claw-memory-search-"));
    await mkdir(path.join(root, "non-investment"), { recursive: true });
    await writeFile(
      path.join(root, "non-investment", "USER.md"),
      [
        "# USER.md",
        "",
        "- Avoid China ADRs",
        "- Keep single position size below 15%",
        "- Prefer pullbacks after catalyst confirmation",
        "",
      ].join("\n"),
      "utf8",
    );

    const memory = new MemoryService(root);
    const results = await memory.search({ query: "single position size 15%", maxResults: 3 });
    expect(results).toHaveLength(1);
    expect(results[0].path).toMatch(/USER\.md$/);
    expect(results[0].snippet).toContain("15%");

    const snippet = await memory.readSnippet({ relativePath: "non-investment/USER.md", from: 3, lines: 2 });
    expect(snippet?.text).toContain("Avoid China ADRs");
    expect(snippet?.text).toContain("15%");
  });

  it("reads snippets from memory_search-style citations and normalized paths", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "stock-claw-memory-search-"));
    await mkdir(path.join(root, "non-investment"), { recursive: true });
    await writeFile(
      path.join(root, "non-investment", "USER.md"),
      [
        "# USER.md",
        "",
        "- Avoid China ADRs",
        "- Keep single position size below 15%",
        "- Prefer pullbacks after catalyst confirmation",
        "",
      ].join("\n"),
      "utf8",
    );

    const memory = new MemoryService(root);
    const citationSnippet = await memory.readSnippet({
      relativePath: "memory/non-investment/USER.md#L3-L4",
    });
    expect(citationSnippet?.from).toBe(3);
    expect(citationSnippet?.lines).toBe(2);
    expect(citationSnippet?.text).toContain("Avoid China ADRs");
    expect(citationSnippet?.text).toContain("15%");

    const slashSnippet = await memory.readSnippet({
      relativePath: "non-investment\\USER.md#L4-L4",
    });
    expect(slashSnippet?.from).toBe(4);
    expect(slashSnippet?.lines).toBe(1);
    expect(slashSnippet?.text).toContain("15%");

    const absoluteSnippet = await memory.readSnippet({
      relativePath: `${path.join(root, "non-investment", "USER.md")}#L5-L5`,
    });
    expect(absoluteSnippet?.from).toBe(5);
    expect(absoluteSnippet?.lines).toBe(1);
    expect(absoluteSnippet?.text).toContain("Prefer pullbacks");
  });

  it("returns null for paths outside the memory root instead of throwing", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "stock-claw-memory-search-"));
    await mkdir(path.join(root, "non-investment"), { recursive: true });
    await writeFile(path.join(root, "non-investment", "USER.md"), "# USER.md\n", "utf8");

    const memory = new MemoryService(root);
    await expect(memory.readSnippet({ relativePath: "../outside.md#L1-L3" })).resolves.toBeNull();
  });
});
