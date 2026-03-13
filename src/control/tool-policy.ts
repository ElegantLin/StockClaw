import { AgentProfileRegistry } from "./agent-profiles.js";
import { ToolCatalog } from "../tools/catalog.js";
import { ToolRegistry, type ToolExecutionContext } from "../tools/registry.js";

export interface ToolPolicyOptions {
  scope?: "root" | "subagent";
  mode?: "default" | "readonly";
}

const SUBAGENT_DENYLIST = new Set([
  "session_status",
  "sessions_spawn",
  "sessions_list",
  "sessions_history",
]);

export class ToolPolicyService {
  constructor(
    private readonly profiles: AgentProfileRegistry,
    private readonly tools: ToolRegistry,
    private readonly catalog: ToolCatalog,
  ) {}

  resolveAllowedToolNames(
    profileId: Parameters<AgentProfileRegistry["get"]>[0],
    options: ToolPolicyOptions = {},
  ): string[] {
    const profile = this.profiles.get(profileId);
    const descriptors = this.tools.describeAll();
    const descriptorMap = new Map(descriptors.map((item) => [item.name, item]));
    const allowedNames = new Set(this.catalog.resolveToolNamesForProfile(profile));

    return [...allowedNames].filter((toolName) => {
      const descriptor = descriptorMap.get(toolName);
      if (!descriptor) {
        return false;
      }
      if (options.scope === "subagent" && SUBAGENT_DENYLIST.has(toolName)) {
        return false;
      }
      if (options.scope === "subagent" && descriptor.category === "session") {
        return false;
      }
      if (options.mode === "readonly" && descriptor.risk !== "read") {
        return false;
      }
      return true;
    });
  }

  createTools(
    profileId: Parameters<AgentProfileRegistry["get"]>[0],
    options: ToolPolicyOptions & ToolExecutionContext,
  ) {
    return this.tools.createTools(this.resolveAllowedToolNames(profileId, options), options);
  }

  createNamedTools(toolNames: readonly string[], context: ToolExecutionContext) {
    return this.tools.createTools(toolNames, context);
  }
}
