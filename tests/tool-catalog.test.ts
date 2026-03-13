import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

import { describe, expect, it } from "vitest";

import { ToolCatalog } from "../src/tools/catalog.js";

describe("ToolCatalog", () => {
  it("loads grouped tool config and expands profile tool names", () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "stock-claw-tools-"));
    const configPath = path.join(tmpDir, "tools.json");
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          alpha: {
            category: "memory",
            risk: "read",
            source: "business",
            alwaysAvailable: true,
            tools: {
              "memory_search": {
                description: "Search memory.",
              },
              "memory_read": {
                description: "Read memory.",
              },
            },
          },
          beta: {
            category: "ops",
            risk: "admin",
            source: "business",
            alwaysAvailable: false,
            tools: {
              "restart_runtime": {
                description: "Restart runtime.",
              },
              "verify_runtime": {
                risk: "read",
                description: "Verify runtime.",
              },
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    try {
      const catalog = new ToolCatalog(configPath);
      expect(catalog.hasGroup("alpha")).toBe(true);
      expect(catalog.hasTool("restart_runtime")).toBe(true);
      expect(catalog.getAlwaysAvailableToolNames()).toEqual(["memory_search", "memory_read"]);
      expect(
        catalog.resolveToolNamesForProfile({
          id: "system_ops",
          description: "ops",
          allowedToolGroups: ["beta"],
          allowedTools: [],
          writeCapabilities: [],
          spawnCapabilities: [],
        }),
      ).toEqual(["memory_search", "memory_read", "restart_runtime", "verify_runtime"]);
      expect(catalog.listBusinessTools().find((tool) => tool.name === "verify_runtime")?.risk).toBe(
        "read",
      );
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
