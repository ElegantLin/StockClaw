import { describe, expect, it } from "vitest";

import { renderTelegramHtml, splitTelegramMessage } from "../src/telegram/format.js";

describe("telegram format", () => {
  it("renders fenced code blocks into Telegram HTML", () => {
    const html = renderTelegramHtml([
      "Analysis result:",
      "",
      "```json",
      '{ "ok": true }',
      "```",
    ].join("\n"));

    expect(html).toContain("Analysis result:");
    expect(html).toContain("<pre><code>");
    expect(html).toContain("{ \"ok\": true }");
    expect(html).toContain("</code></pre>");
  });

  it("keeps code fences intact when splitting long replies", () => {
    const message = [
      "Intro paragraph.",
      "",
      "```ts",
      "const value = 1;",
      "const other = 2;",
      "```",
      "",
      "Tail paragraph.",
    ].join("\n");

    const chunks = splitTelegramMessage(message, 80);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.some((chunk) => chunk.includes("```ts") || chunk.includes("```\nconst value = 1;"))).toBe(true);
    expect(chunks.join("\n")).toContain("Tail paragraph.");
  });

  it("renders headings, emphasis, links, and lists into Telegram HTML", () => {
    const html = renderTelegramHtml([
      "## Portfolio Update",
      "",
      "- **AAPL** stays strong",
      "1. Review [filing](https://example.com/10-k)",
      "> _Watch guidance_",
    ].join("\n"));

    expect(html).toContain("<b>Portfolio Update</b>");
    expect(html).toContain("• <b>AAPL</b> stays strong");
    expect(html).toContain('1. Review <a href="https://example.com/10-k">filing</a>');
    expect(html).toContain("&gt; <i>Watch guidance</i>");
  });
});
