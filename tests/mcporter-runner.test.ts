import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resetSharedMcporterRuntime, runMcporter } from "../src/mcporter/runner.js";

describe("runMcporter", () => {
  afterEach(async () => {
    await resetSharedMcporterRuntime();
  });

  it("lists configured servers", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-mcporter-"));
    const configDir = path.join(dir, "config");
    const configPath = path.join(configDir, "mcporter.json");
    await mkdir(configDir, { recursive: true });
    await writeFile(
      configPath,
      JSON.stringify(
        {
          mcpServers: {
            longport: {
              command: "uv",
              args: ["run", "python", "mcp_server.py"],
            },
            context7: {
              baseUrl: "https://mcp.context7.com/mcp",
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = await runMcporter(["config", "list", "--config", configPath], {});
    expect(result.stdout).toContain("longport");
    expect(result.stdout).toContain("context7");
  });
});
