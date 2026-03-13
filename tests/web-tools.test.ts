import { describe, expect, it } from "vitest";

import { createWebTools } from "../src/tools/web-tools.js";

describe("web research tools", () => {
  it("maps structured search args to the best available MCP web search tool", async () => {
    const calls: Array<{ server: string; tool: string; args: Record<string, unknown> }> = [];
    const tools = createWebTools(
      {
        mcpRuntime: {
          listTools: () => [
            {
              server: "exa",
              name: "web_search_exa",
              description: "Search the web",
              inputSchema: {
                type: "object",
                properties: {
                  query: { type: "string" },
                  numResults: { type: "number" },
                },
              },
            },
          ],
          callTool: async (server: string, tool: string, args: Record<string, unknown>) => {
            calls.push({ server, tool, args });
            return {
              server,
              name: tool,
              content: [{ type: "text", text: "search ok" }],
            };
          },
        } as never,
      } as never,
      {} as never,
    );

    const result = await tools[0].execute(
      "tool-1",
      { query: "AAPL guidance", maxResults: 4 },
      undefined as never,
      undefined as never,
      undefined as never,
    );
    expect(calls).toEqual([{ server: "exa", tool: "web_search_exa", args: { query: "AAPL guidance", numResults: 4 } }]);
    expect(result.details).toMatchObject({ server: "exa", tool: "web_search_exa" });
  });

  it("maps url fetches to a reader-style MCP tool", async () => {
    const calls: Array<{ server: string; tool: string; args: Record<string, unknown> }> = [];
    const tools = createWebTools(
      {
        mcpRuntime: {
          listTools: () => [
            {
              server: "bigmodel",
              name: "webReader",
              description: "Read webpages",
              inputSchema: {
                type: "object",
                properties: {
                  url: { type: "string" },
                },
              },
            },
          ],
          callTool: async (server: string, tool: string, args: Record<string, unknown>) => {
            calls.push({ server, tool, args });
            return {
              server,
              name: tool,
              content: [{ type: "text", text: "fetch ok" }],
            };
          },
        } as never,
      } as never,
      {} as never,
    );

    const result = await tools[1].execute(
      "tool-2",
      { url: "https://example.com" },
      undefined as never,
      undefined as never,
      undefined as never,
    );
    expect(calls).toEqual([{ server: "bigmodel", tool: "webReader", args: { url: "https://example.com" } }]);
    expect(result.details).toMatchObject({ server: "bigmodel", tool: "webReader" });
  });

  it("falls back to direct http fetch when no MCP fetch tool exists", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      ({
        ok: true,
        status: 200,
        url: "https://example.com/final",
        text: async () => "<html><body><h1>Headline</h1><p>Body</p></body></html>",
      }) as Response) as typeof fetch;
    try {
      const tools = createWebTools(
        {
          mcpRuntime: {
            listTools: () => [],
          } as never,
        } as never,
        {} as never,
      );
      const result = await tools[1].execute(
        "tool-3",
        { url: "https://example.com" },
        undefined as never,
        undefined as never,
        undefined as never,
      );
      expect(result.details).toMatchObject({
        server: "direct",
        tool: "web_fetch",
      });
      expect((result.details as { text: string }).text).toContain("Headline");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
