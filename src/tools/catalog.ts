import { readFileSync } from "node:fs";
import path from "node:path";

import type { AgentProfile, ToolCategory, ToolDescriptor, ToolRiskLevel } from "../types.js";

type ToolConfigEntry = ToolDescriptor & {
  group: string;
  alwaysAvailable: boolean;
};

type ToolGroupConfig = {
  category: ToolCategory;
  risk: ToolRiskLevel;
  source: "business";
  alwaysAvailable: boolean;
  tools: Record<string, ToolConfigToolEntry>;
};

type ToolConfigToolEntry = {
  description: string;
  category?: ToolCategory;
  risk?: ToolRiskLevel;
  source?: "business";
  alwaysAvailable?: boolean;
};

const DEFAULT_CONFIG_PATH = path.resolve("config/tools.json");
const TOOL_CATEGORIES = new Set<ToolCategory>([
  "market",
  "research",
  "portfolio",
  "backtest",
  "memory",
  "trade",
  "config",
  "session",
  "ops",
]);
const TOOL_RISKS = new Set<ToolRiskLevel>(["read", "write", "exec", "admin"]);

function ensureCategory(value: unknown, label: string): ToolCategory {
  if (typeof value !== "string" || !TOOL_CATEGORIES.has(value as ToolCategory)) {
    throw new Error(`${label} has an unsupported category.`);
  }
  return value as ToolCategory;
}

function ensureRisk(value: unknown, label: string): ToolRiskLevel {
  if (typeof value !== "string" || !TOOL_RISKS.has(value as ToolRiskLevel)) {
    throw new Error(`${label} has an unsupported risk level.`);
  }
  return value as ToolRiskLevel;
}

function ensureSource(value: unknown, label: string): "business" {
  if (value !== "business") {
    throw new Error(`${label} must declare source 'business'.`);
  }
  return "business";
}

function ensureBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must declare a boolean value.`);
  }
  return value;
}

function ensureGroupName(value: string): string {
  if (!value.trim()) {
    throw new Error("Tool groups must use non-empty names.");
  }
  return value.trim();
}

function parseGroupEntry(groupName: string, raw: unknown): ToolGroupConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Tool group '${groupName}' must be a JSON object.`);
  }
  const input = raw as Record<string, unknown>;
  const tools = input.tools;
  if (!tools || typeof tools !== "object" || Array.isArray(tools)) {
    throw new Error(`Tool group '${groupName}' must declare a tools object.`);
  }

  return {
    category: ensureCategory(input.category, `Tool group '${groupName}'`),
    risk: ensureRisk(input.risk, `Tool group '${groupName}'`),
    source: ensureSource(input.source, `Tool group '${groupName}'`),
    alwaysAvailable: ensureBoolean(
      input.alwaysAvailable,
      `Tool group '${groupName}' alwaysAvailable`,
    ),
    tools: tools as Record<string, ToolConfigToolEntry>,
  };
}

function parseToolEntry(
  groupName: string,
  groupConfig: ToolGroupConfig,
  toolName: string,
  raw: unknown,
): ToolConfigEntry {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Tool '${toolName}' in group '${groupName}' must be a JSON object.`);
  }
  const input = raw as Record<string, unknown>;
  const description = input.description;
  if (typeof description !== "string" || !description.trim()) {
    throw new Error(`Tool '${toolName}' in group '${groupName}' must include a description.`);
  }

  return {
    name: toolName.trim(),
    group: ensureGroupName(groupName),
    category: input.category
      ? ensureCategory(input.category, `Tool '${toolName}'`)
      : groupConfig.category,
    risk: input.risk ? ensureRisk(input.risk, `Tool '${toolName}'`) : groupConfig.risk,
    description: description.trim(),
    source: input.source ? ensureSource(input.source, `Tool '${toolName}'`) : groupConfig.source,
    alwaysAvailable:
      typeof input.alwaysAvailable === "boolean"
        ? input.alwaysAvailable
        : groupConfig.alwaysAvailable,
  };
}

function loadToolEntries(configPath: string): ToolConfigEntry[] {
  const raw = readFileSync(configPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${configPath} must be a JSON object keyed by tool group.`);
  }
  const entries: ToolConfigEntry[] = [];
  for (const [groupName, groupRaw] of Object.entries(parsed as Record<string, unknown>)) {
    const groupConfig = parseGroupEntry(groupName, groupRaw);
    for (const [toolName, toolRaw] of Object.entries(groupConfig.tools)) {
      if (!toolName.trim()) {
        throw new Error(`Tool group '${groupName}' cannot contain an empty tool name.`);
      }
      entries.push(parseToolEntry(groupName, groupConfig, toolName, toolRaw));
    }
  }
  const names = new Set<string>();
  for (const entry of entries) {
    if (names.has(entry.name)) {
      throw new Error(`Duplicate tool descriptor '${entry.name}' in ${configPath}.`);
    }
    names.add(entry.name);
  }
  return entries;
}

export class ToolCatalog {
  private readonly entries: ToolConfigEntry[];
  private readonly names: Set<string>;
  private readonly groups: Set<string>;

  constructor(
    private readonly configPath: string = process.env.STOCK_CLAW_TOOL_CONFIG_PATH || DEFAULT_CONFIG_PATH,
  ) {
    this.entries = loadToolEntries(this.configPath);
    this.names = new Set(this.entries.map((entry) => entry.name));
    this.groups = new Set(this.entries.map((entry) => entry.group));
  }

  listBusinessTools(): ToolConfigEntry[] {
    return [...this.entries];
  }

  hasTool(name: string): boolean {
    return this.names.has(name);
  }

  hasGroup(group: string): boolean {
    return this.groups.has(group);
  }

  getAlwaysAvailableToolNames(): string[] {
    return this.entries.filter((entry) => entry.alwaysAvailable).map((entry) => entry.name);
  }

  resolveToolNamesForProfile(profile: AgentProfile): string[] {
    const names = new Set<string>(this.getAlwaysAvailableToolNames());
    for (const group of profile.allowedToolGroups) {
      for (const entry of this.entries) {
        if (entry.group === group) {
          names.add(entry.name);
        }
      }
    }
    for (const toolName of profile.allowedTools) {
      names.add(toolName);
    }
    return [...names];
  }
}
