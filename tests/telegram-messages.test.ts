import { describe, expect, it } from "vitest";

import { buildMemoryArtifactsMessage } from "../src/telegram/messages.js";

describe("buildMemoryArtifactsMessage", () => {
  it("renders durable memory labels instead of raw category ids", () => {
    const message = buildMemoryArtifactsMessage([
      {
        fileName: "TOOLS.md",
        category: "bootstrap",
        updatedAt: "2026-03-12T00:00:00.000Z",
      },
      {
        fileName: "2026-03-12.md",
        category: "daily",
        updatedAt: "2026-03-12T00:01:00.000Z",
      },
    ]);

    expect(message).toContain("Recent Durable Memory Artifacts");
    expect(message).toContain("TOOLS.md [bootstrap memory]");
    expect(message).toContain("2026-03-12.md [daily flush]");
  });
});
