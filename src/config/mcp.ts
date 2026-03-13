import { readFile } from "node:fs/promises";
import path from "node:path";

export class McpConfigError extends Error {}

interface McpServerBaseConfig {
  name: string;
  env: Record<string, string>;
  headers: Record<string, string>;
}

export interface McpStdioServerConfig extends McpServerBaseConfig {
  command: string;
  args: string[];
  cwd?: string;
  transport: "stdio";
}

export interface McpHttpServerConfig extends McpServerBaseConfig {
  baseUrl: string;
  transport: "http";
}

export type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig;

export async function loadMcpServers(env: NodeJS.ProcessEnv): Promise<McpServerConfig[]> {
  const configPath = await resolveMcpConfigPath(env);
  const raw = await readFile(configPath, "utf8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const servers = parsed.mcpServers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
    throw new McpConfigError("MCP config must contain a top-level 'mcpServers' object.");
  }

  return Object.entries(servers).map(([name, value]) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new McpConfigError(`mcpServers.${name} must be an object.`);
    }
    const config = value as Record<string, unknown>;
    const baseUrl = optionalString(config.baseUrl) || optionalString(config.url);
    if (baseUrl) {
      return {
        name,
        baseUrl,
        env: ensureStringMap(config.env, `mcpServers.${name}.env`),
        headers: ensureStringMap(config.headers, `mcpServers.${name}.headers`),
        transport: "http",
      };
    }
    return {
      name,
      command: requiredString(config.command, `mcpServers.${name}.command`),
      args: ensureStringArray(config.args, `mcpServers.${name}.args`),
      cwd: optionalString(config.cwd),
      env: ensureStringMap(config.env, `mcpServers.${name}.env`),
      headers: {},
      transport: "stdio",
    };
  });
}

export async function resolveMcpConfigPath(env: NodeJS.ProcessEnv): Promise<string> {
  const configured = env.STOCK_CLAW_MCP_CONFIG_PATH?.trim();
  if (configured) {
    return path.resolve(configured);
  }
  return path.resolve("config/mcporter.json");
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new McpConfigError(`${field} must be a non-empty string.`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function ensureStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new McpConfigError(`${field} must be a string array.`);
  }
  return value as string[];
}

function ensureStringMap(value: unknown, field: string): Record<string, string> {
  if (!value) {
    return {};
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new McpConfigError(`${field} must be an object.`);
  }
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}
