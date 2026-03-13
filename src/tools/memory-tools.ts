import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";

import type { ToolExecutionContext, ToolRegistryDeps } from "./contracts.js";
import { jsonToolResult, optionalNumber, readString, requiredString } from "./support.js";

export function createMemoryTools(
  deps: ToolRegistryDeps,
  _context: ToolExecutionContext,
): ToolDefinition[] {
  return [
    {
      name: "memory_search",
      label: "Memory Search",
      description:
        "Search durable memory markdown files semantically enough for recall. Use before answering questions about prior preferences, risk limits, watchlists, or prior conclusions.",
      parameters: Type.Object({
        query: Type.String(),
        maxResults: Type.Optional(Type.Number()),
        minScore: Type.Optional(Type.Number()),
      }),
      execute: async (_toolCallId, params) =>
        jsonToolResult(
          await deps.memory.search({
            query: requiredString(params, "query"),
            maxResults: optionalNumber(params, "maxResults") ?? undefined,
            minScore: optionalNumber(params, "minScore") ?? undefined,
          }),
        ),
    },
    {
      name: "memory_get",
      label: "Memory Get",
      description:
        "Read a focused snippet from a durable memory markdown file. Use after memory_search to keep context small.",
      parameters: Type.Object({
        path: Type.String(),
        from: Type.Optional(Type.Number()),
        lines: Type.Optional(Type.Number()),
      }),
      execute: async (_toolCallId, params) =>
        jsonToolResult(
          await deps.memory.readSnippet({
            relativePath: requiredString(params, "path"),
            from: optionalNumber(params, "from") ?? undefined,
            lines: optionalNumber(params, "lines") ?? undefined,
          }),
        ),
    },
    {
      name: "memory_read",
      label: "Memory Read",
      description: "Read durable memory documents by category or relative markdown path.",
      parameters: Type.Object({
        category: Type.Optional(Type.String()),
        relativePath: Type.Optional(Type.String()),
      }),
      execute: async (_toolCallId, params) => {
        const category = readString(params, "category");
        const relativePath = readString(params, "relativePath");
        if (relativePath) {
          const docs = await deps.memory.readCategory(relativePath.split(/[\\/]/, 1)[0] || "non-investment");
          const matched = docs.find((doc) =>
            doc.path.replace(/\\/g, "/").endsWith(relativePath.replace(/\\/g, "/")),
          );
          return jsonToolResult(matched ?? null);
        }
        return jsonToolResult(await deps.memory.readCategory(category || "non-investment"));
      },
    },
  ];
}
