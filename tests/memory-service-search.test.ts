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
});
