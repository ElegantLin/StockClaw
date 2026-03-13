import { describe, expect, it } from "vitest";

import { AgentProfileRegistry } from "../src/control/agent-profiles.js";
import { PromptRegistry } from "../src/prompts/registry.js";
import { ToolCatalog } from "../src/tools/catalog.js";

describe("Agent profile consistency", () => {
  it("keeps orchestrator spawn capabilities aligned with the shared root spawn list", () => {
    const tools = new ToolCatalog();
    const registry = new AgentProfileRegistry(tools);
    const orchestrator = registry.get("orchestrator");
    expect(orchestrator.spawnCapabilities).toEqual(registry.getRootSpawnableProfiles());
  });

  it("only references tool groups and tools that exist in the tool catalog", () => {
    const tools = new ToolCatalog();
    const descriptorNames = new Set(tools.listBusinessTools().map((item) => item.name));
    const groups = new Set(tools.listBusinessTools().map((item) => item.group));
    const profiles = new AgentProfileRegistry(tools).list();
    for (const profile of profiles) {
      for (const group of profile.allowedToolGroups) {
        expect(groups.has(group), `${profile.id} references unknown tool group ${group}`).toBe(
          true,
        );
      }
      for (const toolName of profile.allowedTools) {
        expect(descriptorNames.has(toolName), `${profile.id} references unknown tool ${toolName}`).toBe(
          true,
        );
      }
    }
  });

  it("lists every root-spawnable specialist in the orchestrator prompt directory", async () => {
    const tools = new ToolCatalog();
    const registry = new AgentProfileRegistry(tools);
    const prompts = new PromptRegistry("prompts", {
      SPECIALIST_LIST: () =>
        registry
          .getRootSpawnableProfiles()
          .map((profileId) => `- \`${profileId}\`: ${registry.get(profileId).description}`)
          .join("\n"),
    });
    const markdown = await prompts.composeAgentPrompt("orchestrator");
    for (const profileId of registry.getRootSpawnableProfiles()) {
      expect(markdown.includes(`\`${profileId}\``), `available_specialists is missing ${profileId}`).toBe(
        true,
      );
    }
  });
});
