import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { RuntimeEventLogger } from "../src/runtime-logging/logger.js";

describe("RuntimeEventLogger", () => {
  it("appends structured jsonl records", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "stock-claw-runtime-event-logger-"));
    const logger = new RuntimeEventLogger(root, "runtime.jsonl", false);

    await logger.info({
      component: "tool",
      type: "tool_call_completed",
      sessionId: "web:test",
      data: {
        toolName: "exec_command",
        route: "mcporter",
      },
    });
    await logger.close();

    const file = await readFile(path.join(root, "runtime.jsonl"), "utf8");
    const records = file.trim().split(/\r?\n/).map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      level: "info",
      component: "tool",
      type: "tool_call_completed",
      sessionId: "web:test",
      data: {
        toolName: "exec_command",
        route: "mcporter",
      },
    });
    expect(typeof records[0].timestamp).toBe("string");
  });
});
