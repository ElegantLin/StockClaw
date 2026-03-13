import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { AgentProfileRegistry } from "../src/control/agent-profiles.js";
import { ToolCatalog } from "../src/tools/catalog.js";

async function writeConfig(profiles: unknown) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-agent-registry-"));
  const configPath = path.join(dir, "agents.json");
  await writeFile(configPath, JSON.stringify(profiles, null, 2), "utf8");
  return configPath;
}

describe("AgentProfileRegistry", () => {
  it("loads configured non-root subagents without a static whitelist", async () => {
    const configPath = await writeConfig([
      {
        id: "orchestrator",
        description: "Root coordinator.",
        allowedToolGroups: ["sessions"],
        allowedTools: ["exec_command"],
        writeCapabilities: ["memory"],
        spawnCapabilities: ["custom_specialist"],
      },
      {
        id: "custom_specialist",
        description: "A dynamically configured specialist.",
        allowedToolGroups: ["research"],
        allowedTools: ["web_search"],
        writeCapabilities: [],
        spawnCapabilities: [],
      },
    ]);

    const registry = new AgentProfileRegistry(new ToolCatalog(), configPath);

    expect(registry.get("custom_specialist").description).toBe(
      "A dynamically configured specialist.",
    );
    expect(registry.getRootSpawnableProfiles()).toEqual(["custom_specialist"]);
  });

  it("requires orchestrator to exist in config", async () => {
    const configPath = await writeConfig([
      {
        id: "custom_specialist",
        description: "A dynamically configured specialist.",
        allowedToolGroups: ["research"],
        allowedTools: ["web_search"],
        writeCapabilities: [],
        spawnCapabilities: [],
      },
    ]);

    expect(() => new AgentProfileRegistry(new ToolCatalog(), configPath)).toThrow(
      "Missing required agent profile 'orchestrator'",
    );
  });

  it("rejects spawn capabilities that reference unknown configured agents", async () => {
    const configPath = await writeConfig([
      {
        id: "orchestrator",
        description: "Root coordinator.",
        allowedToolGroups: ["sessions"],
        allowedTools: ["exec_command"],
        writeCapabilities: ["memory"],
        spawnCapabilities: ["missing_specialist"],
      },
    ]);

    expect(() => new AgentProfileRegistry(new ToolCatalog(), configPath)).toThrow(
      "unsupported spawn capability 'missing_specialist'",
    );
  });
});
