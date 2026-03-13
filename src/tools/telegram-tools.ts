import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";

import type { ToolExecutionContext, ToolRegistryDeps } from "./contracts.js";
import { jsonToolResult, readString, requiredString } from "./support.js";

export function createTelegramTools(
  deps: ToolRegistryDeps,
  context: ToolExecutionContext,
): ToolDefinition[] {
  return [
    {
      name: "telegram_react",
      label: "Telegram React",
      description:
        "Add a Telegram reaction to the current user message in this Telegram chat. Use sparingly as a lightweight acknowledgement or tone signal.",
      parameters: Type.Object({
        emoji: Type.String(),
        isBig: Type.Optional(Type.Boolean()),
      }),
      execute: async (_toolCallId, params) => {
        if (!context.sessionKey.startsWith("telegram:")) {
          throw new Error("telegram_react only works inside a Telegram session.");
        }
        const messageId = readTelegramMessageId(context, "telegram_react");
        return jsonToolResult(
          await deps.telegram.sendSessionReaction(context.sessionKey, {
            messageId,
            emoji: requiredString(params, "emoji"),
            isBig: readBoolean(params, "isBig"),
          }),
        );
      },
    },
    {
      name: "telegram_download_attachment",
      label: "Telegram Download Attachment",
      description:
        "Download and save an attachment from the current Telegram user message to the local telegram-downloads directory.",
      parameters: Type.Object({
        attachmentIndex: Type.Optional(Type.Integer({ minimum: 0 })),
        fileName: Type.Optional(Type.String()),
      }),
      execute: async (_toolCallId, params) => {
        if (!context.sessionKey.startsWith("telegram:")) {
          throw new Error("telegram_download_attachment only works inside a Telegram session.");
        }
        const messageId = readTelegramMessageId(context, "telegram_download_attachment");
        return jsonToolResult(
          await deps.telegram.downloadSessionAttachment(context.sessionKey, {
            messageId,
            attachmentIndex: readAttachmentIndex(params),
            fileName: readString(params, "fileName"),
            requestMetadata: context.requestMetadata,
          }),
        );
      },
    },
    {
      name: "telegram_send_file",
      label: "Telegram Send File",
      description:
        "Send a file to the current Telegram chat. Use only when the user explicitly wants the result as a file artifact.",
      parameters: Type.Object({
        fileName: Type.String(),
        content: Type.String(),
        caption: Type.Optional(Type.String()),
        mimeType: Type.Optional(Type.String()),
      }),
      execute: async (_toolCallId, params) => {
        if (!context.sessionKey.startsWith("telegram:")) {
          throw new Error("telegram_send_file only works inside a Telegram session.");
        }
        return jsonToolResult(
          await deps.telegram.sendSessionFile(context.sessionKey, {
            fileName: requiredString(params, "fileName"),
            content: requiredString(params, "content"),
            caption: readString(params, "caption"),
            mimeType: readString(params, "mimeType"),
          }),
        );
      },
    },
  ];
}

function readTelegramMessageId(context: ToolExecutionContext, toolName: string): number {
  const candidates = [
    context.requestMetadata?.messageId,
    context.requestMetadata?.telegramMessageId,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isInteger(candidate) && candidate > 0) {
      return candidate;
    }
    if (typeof candidate === "string" && /^\d+$/.test(candidate)) {
      return Number(candidate);
    }
  }
  throw new Error(`${toolName} requires the current Telegram message id.`);
}

function readBoolean(raw: unknown, key: string): boolean | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const value = (raw as Record<string, unknown>)[key];
  return typeof value === "boolean" ? value : undefined;
}

function readAttachmentIndex(raw: unknown): number | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const value = (raw as Record<string, unknown>).attachmentIndex;
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}
