import { readFileSync } from "node:fs";
import path from "node:path";

import {
  ROOT_AGENT_PROFILE_ID,
  type AgentProfile,
  type AgentProfileId,
} from "../types.js";
import { ToolCatalog } from "../tools/catalog.js";

const WRITE_CAPABILITIES = new Set(["memory", "portfolio", "config", "skills"]);
const DEFAULT_CONFIG_PATH = path.resolve("config/agents.json");

function asStringArray(
  input: unknown,
  field: string,
  profileId: string,
): string[] {
  if (!Array.isArray(input) || input.some((item) => typeof item !== "string")) {
    throw new Error(`Invalid ${field} for agent profile '${profileId}'.`);
  }
  return [...input];
}

function parseProfile(raw: unknown): AgentProfile {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Agent profile entries must be JSON objects.");
  }
  const input = raw as Record<string, unknown>;
  const id = typeof input.id === "string" ? input.id.trim() : "";
  if (!id) {
    throw new Error(`Invalid agent profile id '${String(input.id)}'.`);
  }
  const description = input.description;
  if (typeof description !== "string" || !description.trim()) {
    throw new Error(`Agent profile '${id}' is missing a description.`);
  }
  const allowedToolGroups = asStringArray(input.allowedToolGroups, "allowedToolGroups", id);
  const allowedTools = asStringArray(input.allowedTools, "allowedTools", id);
  const writeCapabilities = asStringArray(input.writeCapabilities, "writeCapabilities", id);
  const spawnCapabilities = asStringArray(input.spawnCapabilities, "spawnCapabilities", id);

  if (writeCapabilities.some((capability) => !WRITE_CAPABILITIES.has(capability))) {
    throw new Error(`Agent profile '${id}' has an unsupported write capability.`);
  }

  return {
    id,
    description: description.trim(),
    allowedToolGroups,
    allowedTools,
    writeCapabilities: writeCapabilities as AgentProfile["writeCapabilities"],
    spawnCapabilities,
  };
}

function loadAgentProfilesFromDisk(
  configPath: string,
  tools: ToolCatalog,
): Map<AgentProfileId, AgentProfile> {
  const raw = readFileSync(configPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("config/agents.json must be an array of agent profiles.");
  }

  const profiles = new Map<AgentProfileId, AgentProfile>();
  for (const entry of parsed.map((item) => parseProfile(item))) {
    if (profiles.has(entry.id)) {
      throw new Error(`Duplicate agent profile '${entry.id}' in ${configPath}.`);
    }
    for (const group of entry.allowedToolGroups) {
      if (!tools.hasGroup(group)) {
        throw new Error(`Agent profile '${entry.id}' references unknown tool group '${group}'.`);
      }
    }
    for (const toolName of entry.allowedTools) {
      if (!tools.hasTool(toolName)) {
        throw new Error(`Agent profile '${entry.id}' references unknown tool '${toolName}'.`);
      }
    }
    profiles.set(entry.id, entry);
  }

  if (!profiles.has(ROOT_AGENT_PROFILE_ID)) {
    throw new Error(`Missing required agent profile '${ROOT_AGENT_PROFILE_ID}' in ${configPath}.`);
  }

  for (const entry of profiles.values()) {
    for (const profileId of entry.spawnCapabilities) {
      if (!profiles.has(profileId)) {
        throw new Error(`Agent profile '${entry.id}' has an unsupported spawn capability '${profileId}'.`);
      }
    }
  }

  return profiles;
}

function uniqueProfileIds(profileIds: readonly AgentProfileId[]): AgentProfileId[] {
  return [...new Set(profileIds)];
}

export class AgentProfileRegistry {
  private readonly profiles: Map<AgentProfileId, AgentProfile>;

  constructor(
    private readonly tools: ToolCatalog = new ToolCatalog(),
    private readonly configPath: string = process.env.STOCK_CLAW_AGENT_CONFIG_PATH || DEFAULT_CONFIG_PATH,
  ) {
    this.profiles = loadAgentProfilesFromDisk(this.configPath, this.tools);
  }

  has(id: AgentProfileId): boolean {
    return this.profiles.has(id);
  }

  get(id: AgentProfileId): AgentProfile {
    const profile = this.profiles.get(id);
    if (!profile) {
      throw new Error(`Unknown agent profile '${id}'.`);
    }
    return profile;
  }

  list(): AgentProfile[] {
    return [...this.profiles.values()];
  }

  getRootSpawnableProfiles(): AgentProfileId[] {
    return uniqueProfileIds(
      this.get(ROOT_AGENT_PROFILE_ID).spawnCapabilities.filter(
        (profileId) => profileId !== ROOT_AGENT_PROFILE_ID && this.has(profileId),
      ),
    );
  }
}
