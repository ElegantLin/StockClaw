import { readFile } from "node:fs/promises";

import { loadMcpServers, resolveMcpConfigPath } from "../config/mcp.js";
import { McpRuntime } from "../mcp/runtime.js";

export interface McporterResult {
  stdout: string;
  exitCode: number;
}

const sharedRuntimeCache = new Map<string, Promise<McpRuntime>>();

export async function runMcporter(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<McporterResult> {
  const { args, configPath, outputJson } = parseGlobalFlags(argv);
  if (args.length === 0) {
    throw new Error("mcporter requires a subcommand.");
  }

  const effectiveEnv = configPath ? { ...env, STOCK_CLAW_MCP_CONFIG_PATH: configPath } : env;
  const command = args[0];
  if (command === "list") {
    return runList(args.slice(1), effectiveEnv, outputJson);
  }
  if (command === "call") {
    return runCall(args.slice(1), effectiveEnv, outputJson);
  }
  if (command === "config") {
    return runConfig(args.slice(1), effectiveEnv, outputJson);
  }

  throw new Error(`Unsupported mcporter command '${command}'.`);
}

async function runList(
  argv: string[],
  env: NodeJS.ProcessEnv,
  outputJson: boolean,
): Promise<McporterResult> {
  const serverName = argv.find((item) => !item.startsWith("--"));
  const showSchema = argv.includes("--schema");
  const runtime = await getSharedRuntime(env);
  const listed = runtime.listTools().filter((tool) => !serverName || tool.server === serverName);
  if (outputJson) {
    return {
      stdout: JSON.stringify(
        listed.map((tool) => ({
          server: tool.server,
          name: tool.name,
          description: tool.description || "",
          inputSchema: showSchema ? tool.inputSchema || {} : undefined,
        })),
        null,
        2,
      ),
      exitCode: 0,
    };
  }

  if (listed.length === 0) {
    return { stdout: serverName ? `No tools found for server '${serverName}'.` : "No MCP tools found.", exitCode: 0 };
  }

  const lines = listed.map((tool) => {
    const summary = `${tool.server}.${tool.name}${tool.description ? ` - ${tool.description}` : ""}`;
    if (!showSchema) {
      return summary;
    }
    return `${summary}\n${JSON.stringify(tool.inputSchema || {}, null, 2)}`;
  });
  return { stdout: lines.join("\n\n"), exitCode: 0 };
}

export async function resetSharedMcporterRuntime(): Promise<void> {
  const runtimes = await Promise.allSettled(sharedRuntimeCache.values());
  sharedRuntimeCache.clear();
  await Promise.all(
    runtimes.flatMap((result) =>
      result.status === "fulfilled"
        ? [
            result.value.close().catch(() => {
              // ignore noisy third-party server shutdowns
            }),
          ]
        : [],
    ),
  );
}

async function getSharedRuntime(env: NodeJS.ProcessEnv): Promise<McpRuntime> {
  const configPath = await resolveMcpConfigPath(env);
  const key = configPath;
  const existing = sharedRuntimeCache.get(key);
  if (existing) {
    return existing;
  }

  const runtimePromise = loadMcpServers(env).then((servers) => McpRuntime.connect(servers));
  sharedRuntimeCache.set(key, runtimePromise);
  try {
    return await runtimePromise;
  } catch (error) {
    sharedRuntimeCache.delete(key);
    throw error;
  }
}

async function runCall(
  argv: string[],
  env: NodeJS.ProcessEnv,
  outputJson: boolean,
): Promise<McporterResult> {
  const selector = argv[0];
  if (!selector || selector.startsWith("--")) {
    throw new Error("mcporter call requires a <server.tool> selector.");
  }
  const dot = selector.indexOf(".");
  if (dot <= 0 || dot === selector.length - 1) {
    throw new Error(`Invalid tool selector '${selector}'. Expected <server.tool>.`);
  }
  const serverName = selector.slice(0, dot);
  const toolName = selector.slice(dot + 1);

  const args = parseToolArgs(argv.slice(1));
  const runtime = await getSharedRuntime(env);
  const result = await runtime.callTool(serverName, toolName, args);
  if (outputJson) {
    return { stdout: JSON.stringify(result, null, 2), exitCode: 0 };
  }
  const content = [
    `server: ${result.server}`,
    `tool: ${result.name}`,
    ...(result.isError ? ["isError: true"] : []),
    ...result.content.map((item) => JSON.stringify(item)),
    ...(result.structuredContent ? [JSON.stringify(result.structuredContent, null, 2)] : []),
  ];
  return { stdout: content.join("\n"), exitCode: 0 };
}

async function runConfig(
  argv: string[],
  env: NodeJS.ProcessEnv,
  outputJson: boolean,
): Promise<McporterResult> {
  const subcommand = argv[0];
  const configPath = await resolveMcpConfigPath(env);
  const raw = await readFile(configPath, "utf8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const servers = parsed.mcpServers && typeof parsed.mcpServers === "object" && !Array.isArray(parsed.mcpServers)
    ? (parsed.mcpServers as Record<string, unknown>)
    : {};

  if (subcommand === "list") {
    const payload = Object.keys(servers);
    return {
      stdout: outputJson ? JSON.stringify(payload, null, 2) : payload.join("\n"),
      exitCode: 0,
    };
  }

  if (subcommand === "get") {
    const name = argv[1];
    if (!name) {
      return { stdout: raw.trim(), exitCode: 0 };
    }
    const value = servers[name];
    if (!value) {
      throw new Error(`Unknown MCP server '${name}'.`);
    }
    return {
      stdout: JSON.stringify({ [name]: value }, null, 2),
      exitCode: 0,
    };
  }

  throw new Error(`Unsupported mcporter config command '${subcommand || ""}'.`);
}

function parseGlobalFlags(argv: string[]): {
  args: string[];
  configPath?: string;
  outputJson: boolean;
} {
  const args: string[] = [];
  let configPath: string | undefined;
  let outputJson = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--config") {
      configPath = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--output" && argv[index + 1] === "json") {
      outputJson = true;
      index += 1;
      continue;
    }
    args.push(token);
  }
  return { args, configPath, outputJson };
}

function parseToolArgs(argv: string[]): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--args" || token === "--json") {
      const raw = argv[index + 1];
      if (!raw) {
        throw new Error(`mcporter call ${token} requires JSON content.`);
      }
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      Object.assign(args, parsed);
      index += 1;
      continue;
    }
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const rawValue = argv[index + 1];
      if (!key || rawValue == null || rawValue.startsWith("--")) {
        continue;
      }
      args[key] = coerceArgument(rawValue);
      index += 1;
      continue;
    }
    const eq = token.indexOf("=");
    if (eq > 0) {
      const key = token.slice(0, eq);
      const rawValue = token.slice(eq + 1);
      args[key] = coerceArgument(rawValue);
    }
  }
  return args;
}

function coerceArgument(value: string): unknown {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (value === "null") {
    return null;
  }
  const numeric = Number(value);
  if (value.trim() && Number.isFinite(numeric) && /^-?\d+(?:\.\d+)?$/.test(value)) {
    return numeric;
  }
  if ((value.startsWith("{") && value.endsWith("}")) || (value.startsWith("[") && value.endsWith("]"))) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}
