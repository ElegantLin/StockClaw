import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { archiveSessionToMemory } from "../src/memory/session-archive.js";
import { MemoryService } from "../src/memory/service.js";
import type { AppSessionRecord } from "../src/types.js";

describe("archiveSessionToMemory", () => {
  it("writes session archives into memory/YYYY-MM-DD-slug.md", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-session-archive-"));
    const memory = new MemoryService(dir);
    const session: AppSessionRecord = {
      sessionId: "abc123",
      userId: "user-1",
      channel: "telegram",
      createdAt: "2026-03-08T00:00:00.000Z",
      updatedAt: "2026-03-08T00:10:00.000Z",
      lastIntent: "chat",
      transcript: [
        { role: "user", content: "review AAPL and remember my rules", timestamp: "2026-03-08T00:00:00.000Z" },
        { role: "assistant", content: "Noted.", timestamp: "2026-03-08T00:00:10.000Z" },
      ],
      lastResult: null,
      sessionSummary: null,
      sessionSummaryUpdatedAt: null,
      lastUsage: null,
      cumulativeUsage: {
        turns: 0,
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        contextTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    };

    const relative = await archiveSessionToMemory({
      memory,
      session,
      command: "/new",
      timestamp: "2026-03-08T08:15:00.000Z",
    });

    expect(relative).toMatch(/^memory\/2026-03-08-/);
    const absolute = path.join(dir, relative!.replace(/^memory\//, ""));
    const written = await readFile(absolute, "utf8");
    expect(written).toContain("# Session Archive 2026-03-08");
    expect(written).toContain("review AAPL");
  });
});
