import path from "node:path";
import { spawn } from "node:child_process";

import { Type } from "@sinclair/typebox";

import type { AgentProfileId, ToolDescriptor } from "../types.js";
import type { SessionToolController } from "./contracts.js";

export function inferMcpCategory(name: string): ToolDescriptor["category"] {
  const normalized = name.toLowerCase();
  if (normalized.includes("news")) {
    return "research";
  }
  return "market";
}

export function jsonToolResult(details: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof details === "string" ? details : JSON.stringify(details, null, 2),
      },
    ],
    details,
  };
}

export function tradeParamsSchema() {
  return Type.Object({
    symbol: Type.String(),
    quantity: Type.Number(),
    orderType: Type.Optional(Type.String({ enum: ["market", "limit"] as never })),
    limitPrice: Type.Optional(Type.Number()),
    rationale: Type.Optional(Type.String()),
  });
}

export function agentProfileIdSchema(values: readonly AgentProfileId[]) {
  if (values.length === 0) {
    return Type.String({ pattern: "a^" });
  }
  if (values.length === 1) {
    return Type.Literal(values[0]);
  }
  return Type.Union(values.map((value) => Type.Literal(value)));
}

export function readString(params: unknown, key: string): string | undefined {
  if (!params || typeof params !== "object") {
    return undefined;
  }
  const value = (params as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function requiredString(params: unknown, key: string): string {
  const value = readString(params, key);
  if (!value) {
    throw new Error(`Missing required string parameter '${key}'.`);
  }
  return value;
}

export function requiredNumber(params: unknown, key: string): number {
  if (!params || typeof params !== "object") {
    throw new Error(`Missing required numeric parameter '${key}'.`);
  }
  const value = (params as Record<string, unknown>)[key];
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error(`Invalid numeric parameter '${key}'.`);
  }
  return numeric;
}

export function optionalNumber(params: unknown, key: string): number | null {
  if (!params || typeof params !== "object") {
    return null;
  }
  const value = (params as Record<string, unknown>)[key];
  if (value == null || value === "") {
    return null;
  }
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function readStringArray(params: unknown, key: string): string[] {
  if (!params || typeof params !== "object") {
    return [];
  }
  const value = (params as Record<string, unknown>)[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

export function readStringMap(params: unknown, key: string): Record<string, string> {
  if (!params || typeof params !== "object") {
    return {};
  }
  const value = (params as Record<string, unknown>)[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

export function readObject(params: unknown, key: string): Record<string, unknown> {
  if (!params || typeof params !== "object") {
    return {};
  }
  const value = (params as Record<string, unknown>)[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export function readOrderType(params: unknown): "market" | "limit" {
  const value = readString(params, "orderType");
  return value === "limit" ? "limit" : "market";
}

export function readTarget(
  params: unknown,
  fallback: "llm" | "mcp" | "all",
): "llm" | "mcp" | "all" {
  const value = readString(params, "target");
  return value === "llm" || value === "mcp" || value === "all" ? value : fallback;
}

export function requiredAllowedString(
  params: unknown,
  key: string,
  allowedValues: readonly string[],
): string {
  const value = requiredString(params, key);
  if (!allowedValues.includes(value)) {
    throw new Error(`Unknown ${key} '${value}'.`);
  }
  return value;
}

export function pathCategory(relativePath: string): string {
  return path.normalize(relativePath).split(path.sep, 1)[0] || "user";
}

export function tokenizeCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (quote) {
      if (char === quote) {
        quote = null;
      } else if (char === "\\" && index + 1 < command.length) {
        current += command[index + 1];
        index += 1;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current) {
    tokens.push(current);
  }
  return tokens;
}

const DESTRUCTIVE_COMMAND_PATTERNS = [
  /\brm\b/i,
  /\brmdir\b/i,
  /\bdel\b/i,
  /\berase\b/i,
  /\bremove-item\b/i,
  /\bunlink\b/i,
  /\bdrop\b/i,
  /\bdelete\b/i,
  /\buninstall\b/i,
];

const USER_CONFIRMATION_PATTERNS = [
  /确认/i,
  /同意/i,
  /批准/i,
  /可以删/i,
  /删除吧/i,
  /可以删除/i,
  /\bconfirm\b/i,
  /\byes\b/i,
  /\bapprove\b/i,
  /\bdelete\b/i,
  /\bremove\b/i,
];

export function isDestructiveCommand(command: string): boolean {
  return DESTRUCTIVE_COMMAND_PATTERNS.some((pattern) => pattern.test(command));
}

export function hasExplicitDestructiveConfirmation(userMessage: string | undefined): boolean {
  if (!userMessage) {
    return false;
  }
  return USER_CONFIRMATION_PATTERNS.some((pattern) => pattern.test(userMessage));
}

export async function runLocalShellCommand(
  command: string,
  options: { cwd?: string; timeoutMs?: number } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  const timeoutMs = Math.max(1000, Math.min(options.timeoutMs ?? 20000, 120000));
  const cwd = options.cwd || process.cwd();
  const isWindows = process.platform === "win32";
  const executable = isWindows ? "powershell.exe" : "/bin/sh";
  const args = isWindows
    ? ["-NoProfile", "-NonInteractive", "-Command", command]
    : ["-lc", command];

  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Command timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code,
      });
    });
  });
}

export function ensureSessionController(
  controller: SessionToolController | null,
): asserts controller is SessionToolController {
  if (!controller) {
    throw new Error("Session tools are not configured.");
  }
}
