import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveMemoryFlushPrompt } from "../src/memory/flush.js";
import { MemoryService } from "../src/memory/service.js";
import { formatTranscriptForCompactionSummary } from "../src/memory/session-compaction-summary.js";

describe("memory flush prompt helpers", () => {
  it("replaces YYYY-MM-DD placeholders with the run date", () => {
    const prompt = resolveMemoryFlushPrompt("write to memory/YYYY-MM-DD.md", "2026-03-08T12:00:00.000Z");
    expect(prompt).toContain("memory/2026-03-08.md");
  });

  it("appends to the dated durable memory log", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-memory-flush-"));
    const memory = new MemoryService(dir);

    await memory.appendDocument("2026-03-08.md", "Memory Flush", ["avoid chasing momentum"]);
    await memory.appendDocument("2026-03-08.md", "Memory Flush", ["single-name position <= 10%"]);

    const written = await readFile(path.join(dir, "2026-03-08.md"), "utf8");
    expect(written).toContain("avoid chasing momentum");
    expect(written).toContain("single-name position <= 10%");
  });

  it("formats the full current session transcript for compaction summary", () => {
    const formatted = formatTranscriptForCompactionSummary([
      { role: "user", content: "Track AAPL and avoid margin.", timestamp: "2026-03-10T09:00:00.000Z" },
      { role: "assistant", content: "Noted. I will treat margin as disallowed.", timestamp: "2026-03-10T09:00:02.000Z" },
      { role: "user", content: "Single-name positions should stay under 12%.", timestamp: "2026-03-10T09:05:00.000Z" },
    ]);

    expect(formatted).toContain("Track AAPL and avoid margin.");
    expect(formatted).toContain("Single-name positions should stay under 12%.");
    expect(formatted).toContain("assistant 2026-03-10T09:00:02.000Z");
  });
});
