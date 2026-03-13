import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";

import type {
  SessionToolController,
  ToolExecutionContext,
  ToolRegistryDeps,
} from "./contracts.js";
import { ensureSessionController, jsonToolResult } from "./support.js";

export function createSessionTools(
  deps: ToolRegistryDeps,
  context: ToolExecutionContext,
  sessionController: SessionToolController | null,
): ToolDefinition[] {
  return [
    {
      name: "session_status",
      label: "Session Status",
      description:
        "Inspect the current root session, including transcript size, estimated context window usage, summary, and spawned specialists.",
      parameters: Type.Object({}),
      execute: async () => {
        ensureSessionController(sessionController);
        return jsonToolResult(await sessionController.status(context.sessionKey, context.requestId));
      },
    },
  ];
}
