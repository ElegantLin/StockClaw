import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";

import { runMcporter } from "../mcporter/runner.js";
import type {
  SessionToolController,
  ToolExecutionContext,
  ToolRegistryDeps,
} from "./contracts.js";
import {
  agentProfileIdSchema,
  ensureSessionController,
  jsonToolResult,
  hasExplicitDestructiveConfirmation,
  isDestructiveCommand,
  optionalNumber,
  readOrderType,
  readString,
  readStringArray,
  readStringMap,
  readTarget,
  requiredAllowedString,
  requiredNumber,
  requiredString,
  runLocalShellCommand,
  tokenizeCommand,
  tradeParamsSchema,
} from "./support.js";

export function createActionTools(
  deps: ToolRegistryDeps,
  context: ToolExecutionContext,
  sessionController: SessionToolController | null,
): ToolDefinition[] {
  const spawnableProfiles = deps.profiles.getRootSpawnableProfiles();
  const spawnableProfilesLabel = spawnableProfiles.join(", ");
  return [
    {
      name: "paper_trade_buy",
      label: "Paper Trade Buy",
      description:
        "Execute a paper buy order. Use only after risk checks and user-confirmed buy intent.",
      parameters: tradeParamsSchema(),
      execute: async (_toolCallId, params) =>
        jsonToolResult(
          await deps.executor.execute({
            symbol: requiredString(params, "symbol"),
            side: "buy",
            quantity: requiredNumber(params, "quantity"),
            orderType: readOrderType(params),
            limitPrice: optionalNumber(params, "limitPrice"),
            rationale: readString(params, "rationale") || "paper_buy tool call",
          }, {
            sessionId: context.sessionKey,
            rootUserMessage:
              context.rootUserMessage ||
              `Execute a paper buy for ${requiredString(params, "symbol")} requested through ${context.profileId}.`,
            purpose: "Resolve a live executable quote for a paper buy order.",
          }),
        ),
    },
    {
      name: "paper_trade_sell",
      label: "Paper Trade Sell",
      description:
        "Execute a paper sell order. Use only after risk checks and user-confirmed sell intent.",
      parameters: tradeParamsSchema(),
      execute: async (_toolCallId, params) =>
        jsonToolResult(
          await deps.executor.execute({
            symbol: requiredString(params, "symbol"),
            side: "sell",
            quantity: requiredNumber(params, "quantity"),
            orderType: readOrderType(params),
            limitPrice: optionalNumber(params, "limitPrice"),
            rationale: readString(params, "rationale") || "paper_sell tool call",
          }, {
            sessionId: context.sessionKey,
            rootUserMessage:
              context.rootUserMessage ||
              `Execute a paper sell for ${requiredString(params, "symbol")} requested through ${context.profileId}.`,
            purpose: "Resolve a live executable quote for a paper sell order.",
          }),
        ),
    },
    {
      name: "config_get",
      label: "Config Get",
      description: "Read LLM or MCP configuration files.",
      parameters: Type.Object({
        target: Type.Optional(Type.String({ enum: ["llm", "mcp", "all"] as never })),
      }),
      execute: async (_toolCallId, params) =>
        jsonToolResult(await deps.config.getSnapshot(readTarget(params, "all"))),
    },
    {
      name: "config_patch",
      label: "Config Patch",
      description: "Patch MCP config or JSON-backed LLM config with a JSON merge patch.",
      parameters: Type.Object({
        target: Type.String({ enum: ["llm", "mcp"] as never }),
        patch: Type.String(),
      }),
      execute: async (_toolCallId, params) =>
        jsonToolResult(
          await deps.config.patchConfig(
            readTarget(params, "mcp") as "llm" | "mcp",
            requiredString(params, "patch"),
          ),
        ),
    },
    {
      name: "config_apply",
      label: "Config Apply",
      description: "Replace MCP or LLM config with raw JSON or TOML content.",
      parameters: Type.Object({
        target: Type.String({ enum: ["llm", "mcp"] as never }),
        raw: Type.String(),
      }),
      execute: async (_toolCallId, params) =>
        jsonToolResult(
          await deps.config.applyConfig(
            readTarget(params, "mcp") as "llm" | "mcp",
            requiredString(params, "raw"),
          ),
        ),
    },
    {
      name: "install_mcp",
      label: "Install MCP",
      description: "Register an MCP server into MCP config.",
      parameters: Type.Object({
        name: Type.String(),
        command: Type.String(),
        args: Type.Array(Type.String()),
        cwd: Type.Optional(Type.String()),
        env: Type.Optional(Type.Object({}, { additionalProperties: Type.String() })),
      }),
      execute: async (_toolCallId, params) =>
        jsonToolResult(
          await deps.ops.installMcp({
            name: requiredString(params, "name"),
            command: requiredString(params, "command"),
            args: readStringArray(params, "args"),
            cwd: readString(params, "cwd"),
            env: readStringMap(params, "env"),
          }),
        ),
    },
    {
      name: "install_skill",
      label: "Install Skill",
      description: "Install a skill from a local path or git URL into the local skills directory.",
      parameters: Type.Object({
        source: Type.String(),
        name: Type.Optional(Type.String()),
      }),
      execute: async (_toolCallId, params) =>
        jsonToolResult(
          await deps.ops.installSkill({
            source: requiredString(params, "source"),
            name: readString(params, "name"),
          }),
        ),
    },
    {
      name: "verify_runtime",
      label: "Verify Runtime",
      description: "Verify current MCP and LLM config can be loaded.",
      parameters: Type.Object({
        target: Type.Optional(Type.String({ enum: ["llm", "mcp", "all"] as never })),
      }),
      execute: async (_toolCallId, params) =>
        jsonToolResult(await deps.ops.verifyRuntime(readTarget(params, "all"))),
    },
    {
      name: "restart_runtime",
      label: "Restart Runtime",
      description:
        "Schedule a full stock-claw daemon restart. Always provide a short user-facing note for the post-restart delivery.",
      parameters: Type.Object({
        note: Type.String(),
        reason: Type.Optional(Type.String()),
      }),
      execute: async (_toolCallId, params) =>
        jsonToolResult(
          await deps.restart.requestRestart({
            sessionId: context.sessionKey,
            channel: context.sessionKey.startsWith("telegram:") ? "telegram" : "web",
            note: requiredString(params, "note"),
            reason: readString(params, "reason"),
          }),
        ),
    },
    {
      name: "sessions_spawn",
      label: "Sessions Spawn",
      description:
        `Spawn a focused subagent when a dedicated specialist lens is required. Valid profileId values are ${spawnableProfilesLabel}. Returns the specialist summary and tool calls.`,
        parameters: Type.Object({
          profileId: agentProfileIdSchema([...spawnableProfiles]),
          task: Type.String(),
        }),
      execute: async (_toolCallId, params) => {
        ensureSessionController(sessionController);
        if (!context.requestId || !context.rootUserMessage) {
          throw new Error("sessions_spawn requires request context.");
        }
        return jsonToolResult(
          await sessionController.spawn({
            rootSessionId: context.sessionKey,
            requestId: context.requestId,
            requesterProfileId: context.profileId,
            profileId: requiredAllowedString(params, "profileId", spawnableProfiles),
            task: requiredString(params, "task"),
            rootUserMessage: context.rootUserMessage,
          }),
        );
      },
    },
    {
      name: "sessions_list",
      label: "Sessions List",
      description: "List specialist runs already created under the current root session.",
      parameters: Type.Object({}),
      execute: async () => {
        ensureSessionController(sessionController);
        return jsonToolResult(await sessionController.list(context.sessionKey));
      },
    },
    {
      name: "sessions_history",
      label: "Sessions History",
      description:
        "Read spawned specialist history. Defaults to the current request when requestId is omitted.",
      parameters: Type.Object({
        requestId: Type.Optional(Type.String()),
      }),
      execute: async (_toolCallId, params) => {
        ensureSessionController(sessionController);
        return jsonToolResult(
          await sessionController.history(
            context.sessionKey,
            readString(params, "requestId") || context.requestId,
          ),
        );
      },
    },
    {
      name: "exec_command",
      label: "Exec Command",
      description:
        "Run a local shell command for CLI workflows, inspections, package operations, and skills such as mcporter. Destructive delete or removal commands require explicit user confirmation in the current turn.",
      parameters: Type.Object({
        command: Type.String(),
        cwd: Type.Optional(Type.String()),
        timeoutMs: Type.Optional(Type.Number()),
      }),
      execute: async (_toolCallId, params) => {
        const command = requiredString(params, "command");
        if (isDestructiveCommand(command) && !hasExplicitDestructiveConfirmation(context.rootUserMessage)) {
          throw new Error(
            "Destructive delete/remove commands require explicit user confirmation in the current turn.",
          );
        }
        const tokens = tokenizeCommand(command);
        if (tokens[0] === "mcporter") {
          const result = await runMcporter(tokens.slice(1), process.env);
          return {
            content: [{ type: "text", text: result.stdout }],
            details: {
              command,
              exitCode: result.exitCode,
              mode: "mcporter",
            },
          };
        }
        const result = await runLocalShellCommand(command, {
          cwd: readString(params, "cwd"),
          timeoutMs: optionalNumber(params, "timeoutMs") ?? 20000,
        });
        return {
          content: [{ type: "text", text: [result.stdout, result.stderr].filter(Boolean).join("\n") || "(no output)" }],
          details: {
            command,
            exitCode: result.exitCode,
            stderr: result.stderr,
            mode: "shell",
          },
        };
      },
    },
  ];
}
