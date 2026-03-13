import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";

import type { McpServerConfig } from "../config/mcp.js";
import type { RuntimeEventLogger } from "../runtime-logging/logger.js";

interface McpToolDescriptor {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface McpConnection {
  name: string;
  client: McpClient;
  transport: StdioClientTransport | StreamableHTTPClientTransport;
  tools: McpToolDescriptor[];
}

export interface McpListedTool {
  server: string;
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpToolCallResult {
  server: string;
  name: string;
  content: Array<Record<string, unknown>>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export class McpRuntime {
  private constructor(
    private readonly connections: McpConnection[],
    private readonly runtimeLogger: RuntimeEventLogger | null = null,
  ) {}

  static async connect(
    servers: McpServerConfig[],
    connector: (server: McpServerConfig) => Promise<McpConnection> = connectServer,
    runtimeLogger: RuntimeEventLogger | null = null,
  ): Promise<McpRuntime> {
    const settled = await Promise.allSettled(servers.map((server) => connector(server)));
    const connections: McpConnection[] = [];
    for (let index = 0; index < settled.length; index += 1) {
      const result = settled[index];
      if (result.status === "fulfilled") {
        connections.push(result.value);
        continue;
      }
      const server = servers[index];
      console.warn(
        `stock-claw mcp server '${server.name}' disabled for this run: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
      );
      await runtimeLogger?.warn({
        component: "mcp",
        type: "server_disabled",
        data: {
          server: server.name,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        },
      });
    }
    return new McpRuntime(connections, runtimeLogger);
  }

  listTools(): McpListedTool[] {
    return this.connections.flatMap((connection) =>
      connection.tools.map((tool) => ({
        server: connection.name,
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    );
  }

  hasTool(toolName: string): boolean {
    return this.listTools().some((tool) => tool.name === toolName);
  }

  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<McpToolCallResult> {
    const connection = this.connections.find((item) => item.name === serverName);
    if (!connection) {
      throw new Error(`Unknown MCP server '${serverName}'.`);
    }

    await this.runtimeLogger?.info({
      component: "mcp",
      type: "tool_call_started",
      data: {
        server: serverName,
        toolName,
      },
    });
    let result;
    try {
      result = await connection.client.callTool({
        name: toolName,
        arguments: args,
      });
    } catch (error) {
      await this.runtimeLogger?.error({
        component: "mcp",
        type: "tool_call_failed",
        data: {
          server: serverName,
          toolName,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
    await this.runtimeLogger?.info({
      component: "mcp",
      type: "tool_call_completed",
      data: {
        server: serverName,
        toolName,
        isError: typeof result.isError === "boolean" ? result.isError : false,
      },
    });
    return {
      server: serverName,
      name: toolName,
      content: Array.isArray(result.content) ? (result.content as Array<Record<string, unknown>>) : [],
      structuredContent:
        result.structuredContent && typeof result.structuredContent === "object"
          ? (result.structuredContent as Record<string, unknown>)
          : undefined,
      isError: typeof result.isError === "boolean" ? result.isError : undefined,
    };
  }

  createPiCustomTools(allowedToolNames?: readonly string[]): ToolDefinition[] {
    const allowSet = allowedToolNames ? new Set(allowedToolNames) : undefined;
    const selected = this.connections.flatMap((connection) =>
      connection.tools
        .filter((tool) => !allowSet || allowSet.has(tool.name))
        .map((tool) => ({ connection, tool })),
    );
    const nameCounts = new Map<string, number>();
    for (const item of selected) {
      nameCounts.set(item.tool.name, (nameCounts.get(item.tool.name) || 0) + 1);
    }

    return selected.map(({ connection, tool }) => {
      const duplicate = (nameCounts.get(tool.name) || 0) > 1;
      const exposedName = duplicate ? `${connection.name}__${tool.name}` : tool.name;
      return {
        name: exposedName,
        label: tool.title || tool.name,
        description: [tool.description || "MCP tool exposed through stock-claw.", `Origin: ${connection.name}`]
          .filter(Boolean)
          .join("\n\n"),
        parameters: ensureObjectSchema(tool.inputSchema) as never,
        execute: async (_toolCallId, params) => {
          await this.runtimeLogger?.info({
            component: "mcp",
            type: "tool_call_started",
            data: {
              server: connection.name,
              toolName: tool.name,
            },
          });
          let result;
          try {
            result = await connection.client.callTool({
              name: tool.name,
              arguments: normalizeArgs(params),
            });
          } catch (error) {
            await this.runtimeLogger?.error({
              component: "mcp",
              type: "tool_call_failed",
              data: {
                server: connection.name,
                toolName: tool.name,
                error: error instanceof Error ? error.message : String(error),
              },
            });
            throw error;
          }
          await this.runtimeLogger?.info({
            component: "mcp",
            type: "tool_call_completed",
            data: {
              server: connection.name,
              toolName: tool.name,
              isError: typeof result.isError === "boolean" ? result.isError : false,
            },
          });
          return {
            content: [
              {
                type: "text",
                text: buildToolResultText(
                  connection.name,
                  tool.name,
                  result as { content?: unknown; structuredContent?: unknown; isError?: boolean },
                ),
              },
            ],
            details: {
              server: connection.name,
              originalToolName: tool.name,
              result,
            },
          };
        },
      } as ToolDefinition;
    });
  }

  async close(): Promise<void> {
    await Promise.all(
      this.connections.map(async (connection) => {
        try {
          await connection.transport.close();
        } catch {
          // Some third-party MCP servers exit noisily on client shutdown.
        }
      }),
    );
  }
}

async function connectServer(server: McpServerConfig): Promise<McpConnection> {
  const transport =
    server.transport === "http"
      ? new StreamableHTTPClientTransport(new URL(server.baseUrl), {
          requestInit: {
            headers: {
              ...server.headers,
              ...server.env,
            },
          },
        })
      : new StdioClientTransport({
          command: server.command,
          args: server.args,
          cwd: server.cwd,
          env: { ...stringEnv(process.env), ...server.env },
          stderr: "inherit",
        });
  const client = new McpClient({ name: "stock-claw", version: "0.1.0" }, { capabilities: {} });
  await client.connect(transport);
  const listed = await client.listTools();
  return {
    name: server.name,
    client,
    transport,
    tools: Array.isArray(listed.tools) ? (listed.tools as McpToolDescriptor[]) : [],
  };
}

function ensureObjectSchema(schema: unknown): Record<string, unknown> {
  if (schema && typeof schema === "object" && !Array.isArray(schema)) {
    return schema as Record<string, unknown>;
  }
  return { type: "object", properties: {} };
}

function normalizeArgs(args: unknown): Record<string, unknown> {
  if (args && typeof args === "object" && !Array.isArray(args)) {
    return args as Record<string, unknown>;
  }
  return {};
}

function stringEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function buildToolResultText(
  serverName: string,
  toolName: string,
  result: { content?: unknown; structuredContent?: unknown; isError?: boolean },
): string {
  const lines = [`MCP tool result from ${serverName}/${toolName}:`];
  if (Array.isArray(result.content)) {
    for (const item of result.content) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const typedItem = item as Record<string, unknown>;
      if (typedItem.type === "text" && typeof typedItem.text === "string") {
        lines.push(typedItem.text);
      } else {
        lines.push(JSON.stringify(typedItem));
      }
    }
  }
  if (result.structuredContent && typeof result.structuredContent === "object") {
    lines.push(JSON.stringify(result.structuredContent));
  }
  if (result.isError) {
    lines.push("The server flagged this call as an error.");
  }
  return lines.join("\n").trim();
}
