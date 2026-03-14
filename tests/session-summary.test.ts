import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { MemoryService } from "../src/memory/service.js";
import {
  buildArchiveSlug,
  buildCompactedSessionSummaryMarkdown,
  buildSessionSummaryMarkdown,
  extractSessionInsights,
  writeCompactedSessionSummary,
  writeLiveSessionSummary,
} from "../src/memory/session-summary.js";

describe("session summary memory", () => {
  it("extracts preferences, constraints, and pending trades", () => {
    const insights = extractSessionInsights({
      userText: "以后不要碰中概股；单只股票仓位不要超过10%；如果AAPL跌到250以下再买入。",
      assistantText: "策略原则：先控制回撤。 Practical conclusion: wait for confirmation.",
    });

    expect(insights.preferences.join("\n")).toContain("不要碰中概股");
    expect(insights.constraints.join("\n")).toContain("仓位不要超过10%");
    expect(insights.pendingTrades.join("\n")).toContain("买入");
    expect(insights.knowledge.join("\n")).toContain("策略原则");
  });

  it("writes a live session summary markdown file", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-live-summary-"));
    const memory = new MemoryService(dir);
    const result = await writeLiveSessionSummary({
      memory,
      sessionId: "session-aapl",
      lastIntent: "investment_research",
      updatedAt: "2026-03-08T00:00:03.000Z",
      transcript: [
        {
          role: "user",
          content: "以后不要碰中概股；AAPL跌到250以下再买入。",
          timestamp: "2026-03-08T00:00:01.000Z",
        },
        {
          role: "assistant",
          content: "Practical conclusion: wait for confirmation.",
          timestamp: "2026-03-08T00:00:02.000Z",
        },
      ],
    });

    const saved = await readFile(path.join(dir, "sessions", "live", "session-aapl.md"), "utf8");
    expect(result.relativePath).toBe("sessions/live/session-aapl.md");
    expect(saved).toContain("Durable User Preferences");
    expect(saved).toContain("不要碰中概股");
    expect(saved).toContain("Pending Trade Intentions");
  });

  it("builds a stable archive slug from the session topic", () => {
    const slug = buildArchiveSlug({
      sessionId: "session-aapl",
      userId: "user-1",
      channel: "web",
      createdAt: "2026-03-08T00:00:00.000Z",
      updatedAt: "2026-03-08T00:00:02.000Z",
      lastIntent: "investment_research",
      transcript: [
        {
          role: "user",
          content: "Analyze AAPL with value and technical lenses.",
          timestamp: "2026-03-08T00:00:01.000Z",
        },
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
    });

    expect(slug).toContain("session-aapl");
    expect(slug).toContain("aapl");
  });

  it("renders a readable markdown summary", () => {
    const markdown = buildSessionSummaryMarkdown({
      sessionId: "session-aapl",
      lastIntent: "trade_request",
      updatedAt: "2026-03-08T00:00:03.000Z",
      transcript: [
        {
          role: "user",
          content: "单只股票仓位不要超过10%；如果AAPL跌到250以下再买入。",
          timestamp: "2026-03-08T00:00:01.000Z",
        },
        {
          role: "assistant",
          content: "Practical conclusion: wait for confirmation.",
          timestamp: "2026-03-08T00:00:02.000Z",
        },
      ],
    });

    expect(markdown).toContain("Risk And Portfolio Constraints");
    expect(markdown).toContain("Pending Trade Intentions");
    expect(markdown).toContain("Practical conclusion");
  });

  it("writes a live summary file from LLM compaction body with code-owned metadata", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-compacted-summary-"));
    const memory = new MemoryService(dir);
    const result = await writeCompactedSessionSummary({
      memory,
      sessionId: "telegram:6544808656",
      lastIntent: "investment_research",
      updatedAt: "2026-03-14T00:00:03.000Z",
      summaryBody: [
        "## Compressed Context",
        "",
        "- Reviewed AAPL and MSFT with focus on near-term positioning.",
        "",
        "## Durable Preferences And Constraints",
        "",
        "- Keep single-position exposure below 15%.",
      ].join("\n"),
    });

    const saved = await readFile(path.join(dir, "sessions", "live", "telegram-6544808656.md"), "utf8");
    expect(result.relativePath).toBe("sessions/live/telegram-6544808656.md");
    expect(saved).toContain("# Live Session Summary");
    expect(saved).toContain("- Session ID: telegram:6544808656");
    expect(saved).toContain("## Compressed Context");
    expect(saved).toContain("Keep single-position exposure below 15%");
  });

  it("removes duplicated summary heading and metadata when wrapping a compacted summary body", () => {
    const markdown = buildCompactedSessionSummaryMarkdown({
      sessionId: "session-aapl",
      lastIntent: "trade_request",
      updatedAt: "2026-03-14T00:00:03.000Z",
      summaryBody: [
        "# Live Session Summary",
        "",
        "- Session ID: stale",
        "- Last Intent: stale",
        "- Updated At: stale",
        "",
        "## Compressed Context",
        "",
        "- Focus on pending AAPL review.",
      ].join("\n"),
    });

    expect(markdown).toContain("- Session ID: session-aapl");
    expect(markdown).not.toContain("- Session ID: stale");
    expect(markdown).toContain("## Compressed Context");
    expect(markdown).not.toContain("# Live Session Summary\n\n# Live Session Summary");
  });
});
