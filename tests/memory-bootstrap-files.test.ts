import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ensureBootstrapMemoryFiles,
  loadBootstrapMemoryFiles,
} from "../src/memory/bootstrap-files.js";
import { MemoryService } from "../src/memory/service.js";

describe("bootstrap memory files", () => {
  it("creates the default bootstrap files on a fresh memory root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "stock-claw-bootstrap-memory-"));
    const memory = new MemoryService(root);

    await ensureBootstrapMemoryFiles(memory);
    const files = await loadBootstrapMemoryFiles(memory);

    expect(files.map((file) => file.relativePath)).toEqual([
      "non-investment/SOUL.md",
      "non-investment/USER.md",
      "non-investment/MEMORY.md",
      "non-investment/TOOLS.md",
      "knowledge/INVESTMENT-PRINCIPLES.md",
    ]);
    expect(files[0]?.content.trim()).toBe("");
    expect(files[1]?.content.trim()).toBe("");
    expect(files[2]?.content.trim()).toBe("");
    expect(files[3]?.content.trim()).toBe("");
    expect(files[4]?.content.trim()).toBe("");
  });

  it("migrates legacy user and investment memory files into the new bootstrap paths", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "stock-claw-bootstrap-memory-"));
    await mkdir(path.join(root, "user"), { recursive: true });
    await mkdir(path.join(root, "knowledge"), { recursive: true });
    await writeFile(
      path.join(root, "user", "profile.md"),
      "# Profile\n\n- Call the user Alex.\n",
      "utf8",
    );
    await writeFile(
      path.join(root, "knowledge", "investment-principles.md"),
      "# Principles\n\n- Avoid concentrated biotech bets.\n",
      "utf8",
    );
    const memory = new MemoryService(root);

    await ensureBootstrapMemoryFiles(memory);

    expect(await memory.readDocument("user/profile.md")).toBeNull();
    expect(await memory.readDocument("non-investment/USER.md")).toContain("Call the user Alex");
    expect(await memory.readDocument("knowledge/INVESTMENT-PRINCIPLES.md")).toContain(
      "Avoid concentrated biotech bets.",
    );
  });
});
