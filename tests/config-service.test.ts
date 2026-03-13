import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { ConfigService } from "../src/config/service.js";

describe("ConfigService", () => {
  it("patches standard mcpServers json", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-config-"));
    const file = path.join(dir, ".mcp.json");
    await writeFile(
      file,
      JSON.stringify(
        {
          mcpServers: {
            longport: {
              command: "uv",
              args: ["run", "python", "mcp_server.py"],
              env: {},
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const service = new ConfigService({ STOCK_CLAW_MCP_CONFIG_PATH: file });
    await service.patchConfig(
      "mcp",
      JSON.stringify({
        mcpServers: {
          longport: {
            cwd: "E:/github/us-share-mcp",
          },
        },
      }),
    );

    const raw = JSON.parse(await readFile(file, "utf8")) as {
      mcpServers: Record<string, { cwd?: string }>;
    };
    expect(raw.mcpServers.longport?.cwd).toBe("E:/github/us-share-mcp");
  });

  it("redacts secrets from snapshots", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-config-redact-"));
    const mcpFile = path.join(dir, ".mcp.json");
    const configDir = path.join(dir, "config");
    const llmFile = path.join(configDir, "llm.local.toml");
    await mkdir(configDir, { recursive: true });
    await writeFile(
      mcpFile,
      JSON.stringify(
        {
          mcpServers: {
            longport: {
              command: "uv",
              env: {
                LONGPORT_APP_KEY: "public-ish",
                LONGPORT_APP_SECRET: "secret-value",
                LONGPORT_ACCESS_TOKEN: "token-value",
              },
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(
      llmFile,
      [
        "[llm]",
        'model = "glm-5"',
        'baseUrl = "https://example.com"',
        'apiKey = "llm-secret"',
      ].join("\n"),
      "utf8",
    );

    const previous = process.cwd();
    process.chdir(dir);
    try {
      const service = new ConfigService({
        STOCK_CLAW_MCP_CONFIG_PATH: mcpFile,
      });

      const snapshot = await service.getSnapshot("all");
      expect(snapshot.mcp?.raw).toContain("[REDACTED]");
      expect(snapshot.mcp?.raw).not.toContain("secret-value");
      expect(snapshot.mcp?.raw).not.toContain("token-value");
      expect(snapshot.llm?.raw).toContain("[REDACTED]");
      expect(snapshot.llm?.raw).not.toContain("llm-secret");
    } finally {
      process.chdir(previous);
    }
  });

  it("triggers a reload hook after mcp config changes", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-config-hook-"));
    const file = path.join(dir, "mcporter.json");
    await writeFile(file, JSON.stringify({ mcpServers: {} }, null, 2), "utf8");
    const afterChange = vi.fn(async () => {});
    const service = new ConfigService({ STOCK_CLAW_MCP_CONFIG_PATH: file }, afterChange);

    await service.patchConfig(
      "mcp",
      JSON.stringify({ mcpServers: { demo: { command: "node", args: [] } } }),
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(afterChange).toHaveBeenCalledWith("mcp");
  });
});
