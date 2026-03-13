import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { ConfigService } from "../src/config/service.js";
import { OpsService } from "../src/ops/service.js";

describe("OpsService", () => {
  it("installs an MCP server without clobbering existing secrets", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-ops-"));
    const mcpFile = path.join(dir, ".mcp.json");
    await writeFile(
      mcpFile,
      JSON.stringify(
        {
          mcpServers: {
            longport: {
              type: "stdio",
              command: "uv",
              args: ["run", "python", "mcp_server.py"],
              env: {
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

    const config = new ConfigService({ STOCK_CLAW_MCP_CONFIG_PATH: mcpFile });
    const ops = new OpsService(config, dir);

    const result = await ops.installMcp({
      name: "demo",
      command: "node",
      args: ["server.js"],
      cwd: dir,
      env: { DEMO_KEY: "demo-value" },
    });

    const updated = JSON.parse(await readFile(mcpFile, "utf8")) as {
      mcpServers: Record<string, { env?: Record<string, string>; type?: string }>;
    };
    expect(result.ok).toBe(true);
    expect(updated.mcpServers.longport?.env?.LONGPORT_APP_SECRET).toBe("secret-value");
    expect(updated.mcpServers.longport?.env?.LONGPORT_ACCESS_TOKEN).toBe("token-value");
    expect(updated.mcpServers.demo?.type).toBe("stdio");
    expect(updated.mcpServers.demo?.env?.DEMO_KEY).toBe("demo-value");
  });

  it("installs a local skill into the local skills directory", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-skill-"));
    const source = path.join(dir, "source-skill");
    await mkdir(source, { recursive: true });
    await writeFile(path.join(source, "SKILL.md"), "# Demo Skill\n", "utf8");

    const config = new ConfigService({ STOCK_CLAW_MCP_CONFIG_PATH: path.join(dir, ".mcp.json") });
    await writeFile(path.join(dir, ".mcp.json"), JSON.stringify({ mcpServers: {} }), "utf8");
    const afterSkillInstall = vi.fn(async () => {});
    const ops = new OpsService(config, dir, afterSkillInstall);

    const result = await ops.installSkill({ source, name: "demo-skill" });

    expect(result.ok).toBe(true);
    const installed = await readFile(path.join(dir, "skills", "demo-skill", "SKILL.md"), "utf8");
    expect(installed).toContain("Demo Skill");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(afterSkillInstall).toHaveBeenCalledTimes(1);
  });
});
