import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";

import type { McpListedTool, McpRuntime, McpToolCallResult } from "../mcp/runtime.js";
import type { ToolExecutionContext, ToolRegistryDeps } from "./contracts.js";
import { jsonToolResult, optionalNumber, requiredString } from "./support.js";

const WEB_SEARCH_NAMES = ["web_search_exa", "web_search", "search_web", "webSearch", "search"];
const WEB_FETCH_NAMES = ["web_fetch", "webReader", "fetch_url", "read_url", "fetch"];

export function createWebTools(
  deps: ToolRegistryDeps,
  _context: ToolExecutionContext,
): ToolDefinition[] {
  return [
    {
      name: "web_search",
      label: "Web Search",
      description:
        "Search the web using the best available MCP-backed research tool. Prefer this over raw mcporter for general news and external research discovery.",
      parameters: Type.Object({
        query: Type.String(),
        maxResults: Type.Optional(Type.Number()),
      }),
      execute: async (_toolCallId, params) =>
        jsonToolResult(
          await runWebCapability({
            runtime: deps.mcpRuntime,
            candidates: WEB_SEARCH_NAMES,
            task: "web_search",
            params: {
              query: requiredString(params, "query"),
              maxResults: optionalNumber(params, "maxResults") ?? 5,
            },
          }),
        ),
    },
    {
      name: "web_fetch",
      label: "Web Fetch",
      description:
        "Fetch a webpage or article through the best available MCP-backed fetch tool. Use this when you already have a target URL.",
      parameters: Type.Object({
        url: Type.String(),
      }),
      execute: async (_toolCallId, params) =>
        jsonToolResult(
          await runWebCapability({
            runtime: deps.mcpRuntime,
            candidates: WEB_FETCH_NAMES,
            task: "web_fetch",
            params: {
              url: requiredString(params, "url"),
            },
          }),
        ),
    },
  ];
}

async function runWebCapability(params: {
  runtime: McpRuntime;
  candidates: string[];
  task: "web_search" | "web_fetch";
  params: { query?: string; maxResults?: number; url?: string };
}) {
  const listed = params.runtime.listTools();
  const tool = resolveCapabilityTool(listed, params.candidates, params.task);
  if (!tool) {
    if (params.task === "web_fetch" && params.params.url) {
      return fetchDirectUrl(params.params.url);
    }
    throw new Error(`No MCP tool available for ${params.task}.`);
  }
  const args =
    params.task === "web_search"
      ? buildSearchArgs(tool, params.params.query || "", params.params.maxResults ?? 5)
      : buildFetchArgs(tool, params.params.url || "");
  const result = await params.runtime.callTool(tool.server, tool.name, args);
  return summarizeCapabilityResult(tool, args, result);
}

function resolveCapabilityTool(
  tools: McpListedTool[],
  preferredNames: string[],
  task: "web_search" | "web_fetch",
): McpListedTool | null {
  const byName = tools.find((tool) => preferredNames.includes(tool.name));
  if (byName) {
    return byName;
  }
  return (
    tools.find((tool) => {
      const lowered = `${tool.name} ${tool.description || ""}`.toLowerCase();
      const properties = schemaProperties(tool.inputSchema);
      if (task === "web_search") {
        return lowered.includes("search") && ("query" in properties || "q" in properties);
      }
      return (
        ("url" in properties || "uri" in properties) &&
        (lowered.includes("fetch") ||
          lowered.includes("reader") ||
          lowered.includes("web") ||
          lowered.includes("article"))
      );
    }) || null
  );
}

function buildSearchArgs(tool: McpListedTool, query: string, maxResults: number): Record<string, unknown> {
  const properties = schemaProperties(tool.inputSchema);
  const args: Record<string, unknown> = {};
  if ("query" in properties) {
    args.query = query;
  } else if ("q" in properties) {
    args.q = query;
  } else {
    args.query = query;
  }

  if ("numResults" in properties) {
    args.numResults = maxResults;
  } else if ("maxResults" in properties) {
    args.maxResults = maxResults;
  } else if ("limit" in properties) {
    args.limit = maxResults;
  }
  return args;
}

function buildFetchArgs(tool: McpListedTool, url: string): Record<string, unknown> {
  const properties = schemaProperties(tool.inputSchema);
  if ("url" in properties) {
    return { url };
  }
  if ("uri" in properties) {
    return { uri: url };
  }
  return { url };
}

function summarizeCapabilityResult(tool: McpListedTool, args: Record<string, unknown>, result: McpToolCallResult) {
  return {
    server: tool.server,
    tool: tool.name,
    args,
    isError: result.isError ?? false,
    text: extractResultText(result),
    structuredContent: result.structuredContent ?? null,
  };
}

function extractResultText(result: McpToolCallResult): string {
  const parts: string[] = [];
  for (const item of result.content) {
    if (!item || typeof item !== "object") {
      continue;
    }
    if (item.type === "text" && typeof item.text === "string") {
      parts.push(item.text);
    } else {
      parts.push(JSON.stringify(item));
    }
  }
  if (!parts.length && result.structuredContent) {
    parts.push(JSON.stringify(result.structuredContent, null, 2));
  }
  return parts.join("\n").trim();
}

function schemaProperties(schema?: Record<string, unknown>): Record<string, unknown> {
  const properties = schema?.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
    return {};
  }
  return properties as Record<string, unknown>;
}

async function fetchDirectUrl(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "stock-claw/0.1 web-fetch",
      },
    });
    const html = await response.text();
    return {
      server: "direct",
      tool: "web_fetch",
      args: { url },
      isError: !response.ok,
      text: stripHtml(html).slice(0, 20_000),
      structuredContent: {
        status: response.status,
        finalUrl: response.url,
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}
