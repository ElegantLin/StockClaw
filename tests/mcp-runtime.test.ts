import { describe, expect, it, vi } from "vitest";

import type { McpServerConfig } from "../src/config/mcp.js";
import { McpRuntime } from "../src/mcp/runtime.js";

describe("McpRuntime.connect", () => {
  it("keeps healthy servers when one server fails to connect", async () => {
    const servers: McpServerConfig[] = [
      {
        name: "healthy",
        transport: "stdio",
        command: "node",
        args: ["healthy.js"],
        env: {},
        headers: {},
      },
      {
        name: "broken",
        transport: "http",
        baseUrl: "https://example.invalid/mcp",
        env: {},
        headers: {},
      },
    ];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const runtime = await McpRuntime.connect(servers, async (server) => {
      if (server.name === "broken") {
        throw new Error("connect timeout");
      }
      return {
        name: server.name,
        client: {
          callTool: vi.fn(),
        } as never,
        transport: {
          close: vi.fn(async () => undefined),
        } as never,
        tools: [{ name: "get_quotes", description: "Get quotes", inputSchema: { type: "object" } }],
      };
    });

    expect(runtime.listTools()).toEqual([
      {
        server: "healthy",
        name: "get_quotes",
        title: undefined,
        description: "Get quotes",
        inputSchema: { type: "object" },
      },
    ]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("stock-claw mcp server 'broken' disabled for this run"));
  });
});
