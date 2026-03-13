import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface TelegramConfig {
  enabled: boolean;
  botToken: string;
  adminChatId: string | null;
  pollingTimeoutSeconds: number;
  pollingIntervalMs: number;
  pairing: {
    enabled: boolean;
    notifyAdmin: boolean;
  };
}

export async function resolveTelegramConfigPath(
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  const configured = env.STOCK_CLAW_TELEGRAM_CONFIG_PATH?.trim();
  if (configured) {
    return path.resolve(configured);
  }
  const preferred = path.resolve("config/telegram.json");
  try {
    await readFile(preferred, "utf8");
    return preferred;
  } catch {
    return null;
  }
}

export async function loadTelegramConfig(
  env: NodeJS.ProcessEnv = process.env,
): Promise<TelegramConfig | null> {
  const configPath = await resolveTelegramConfigPath(env);
  if (!configPath) {
    return null;
  }
  const raw = await readFile(configPath, "utf8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const pairing = ensureObject(parsed.pairing);
  const enabled = parsed.enabled !== false;
  const botToken = enabled ? requiredString(parsed.botToken, "telegram.botToken") : optionalString(parsed.botToken) ?? "";
  return {
    enabled,
    botToken,
    adminChatId: optionalString(parsed.adminChatId) ?? null,
    pollingTimeoutSeconds: toPositiveInt(parsed.pollingTimeoutSeconds, 20),
    pollingIntervalMs: toPositiveInt(parsed.pollingIntervalMs, 1000),
    pairing: {
      enabled: pairing.enabled !== false,
      notifyAdmin: pairing.notifyAdmin !== false,
    },
  };
}

export async function setTelegramAdminChatId(
  chatId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const configPath = await resolveTelegramConfigPath(env);
  if (!configPath) {
    throw new Error("Telegram config file was not found.");
  }
  const raw = await readFile(configPath, "utf8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  parsed.adminChatId = chatId;
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(parsed, null, 2) + "\n", "utf8");
}

export async function clearTelegramAdminChatId(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const configPath = await resolveTelegramConfigPath(env);
  if (!configPath) {
    throw new Error("Telegram config file was not found.");
  }
  const raw = await readFile(configPath, "utf8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  parsed.adminChatId = "";
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(parsed, null, 2) + "\n", "utf8");
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function toPositiveInt(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.floor(value));
}

function ensureObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
