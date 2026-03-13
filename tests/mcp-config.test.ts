import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadMcpServers, resolveMcpConfigPath } from "../src/config/mcp.js";

describe("loadMcpServers", () => {
  it("loads standard stdio mcpServers json", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-mcp-"));
    const file = path.join(dir, "config", "mcporter.json");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(
      file,
      JSON.stringify(
        {
          mcpServers: {
            longport: {
              command: "uv",
              args: ["run", "python", "mcp_server.py"],
              cwd: "E:/github/us-share-mcp",
              env: { LONGPORT_APP_KEY: "key" },
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const servers = await loadMcpServers({ STOCK_CLAW_MCP_CONFIG_PATH: file });
    expect(servers).toHaveLength(1);
    expect(servers[0]?.name).toBe("longport");
    expect(servers[0]?.transport).toBe("stdio");
    expect("args" in (servers[0] || {})).toBe(true);
  });

  it("loads standard http mcpServers json", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-mcp-http-"));
    const file = path.join(dir, "config", "mcporter.json");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(
      file,
      JSON.stringify(
        {
          mcpServers: {
            context7: {
              type: "http",
              url: "https://mcp.context7.com/mcp",
              headers: {
                Authorization: "Bearer test-token",
              },
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const servers = await loadMcpServers({ STOCK_CLAW_MCP_CONFIG_PATH: file });
    expect(servers).toHaveLength(1);
    expect(servers[0]?.name).toBe("context7");
    expect(servers[0]?.transport).toBe("http");
    expect("headers" in (servers[0] || {})).toBe(true);
    if (servers[0]?.transport === "http") {
      expect(servers[0].headers.Authorization).toBe("Bearer test-token");
    }
  });

  it("prefers config/mcporter.json by default", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-mcp-default-"));
    await mkdir(path.join(dir, "config"), { recursive: true });
    await writeFile(path.join(dir, "config", "mcporter.json"), JSON.stringify({ mcpServers: {} }), "utf8");
    const previousCwd = process.cwd();
    process.chdir(dir);
    try {
      const resolved = await resolveMcpConfigPath({});
      expect(resolved).toBe(path.resolve(dir, "config", "mcporter.json"));
    } finally {
      process.chdir(previousCwd);
    }
  });

  it("does not fall back to a root .mcp.json file", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-mcp-no-fallback-"));
    await writeFile(path.join(dir, ".mcp.json"), JSON.stringify({ mcpServers: { legacy: {} } }), "utf8");
    const previousCwd = process.cwd();
    process.chdir(dir);
    try {
      const resolved = await resolveMcpConfigPath({});
      expect(resolved).toBe(path.resolve(dir, "config", "mcporter.json"));
    } finally {
      process.chdir(previousCwd);
    }
  });
});
