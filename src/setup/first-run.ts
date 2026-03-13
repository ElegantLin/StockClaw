import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { loadLlmConfig, resolveLlmConfigPath } from "../config/llm.js";
import { loadMcpServers, resolveMcpConfigPath } from "../config/mcp.js";
import { TelegramHttpBotApi } from "../telegram/bot-api.js";
import { loadTelegramConfig, resolveTelegramConfigPath } from "../telegram/config.js";
import { TelegramExtension } from "../telegram/service.js";

type SetupStatusKind = "ready" | "missing" | "invalid";

interface SetupStatus {
  kind: SetupStatusKind;
  path: string;
  detail?: string;
}

export interface FirstRunSetupState {
  llm: SetupStatus;
  mcp: SetupStatus;
  telegram: SetupStatus;
}

export interface FirstRunSetupResult {
  changed: boolean;
  createdFiles: string[];
}

export interface FirstRunPrompter {
  confirm(message: string, defaultValue?: boolean): Promise<boolean>;
  input(
    message: string,
    options?: {
      defaultValue?: string;
      allowEmpty?: boolean;
    },
  ): Promise<string>;
  close(): Promise<void>;
}

export interface FirstRunSetupDeps {
  interactive?: boolean;
  log?: (message: string) => void;
  prompter?: FirstRunPrompter;
  telegramPairer?: (env: NodeJS.ProcessEnv, prompter: FirstRunPrompter, log: (message: string) => void) => Promise<void>;
}

export async function ensureFirstRunSetup(
  env: NodeJS.ProcessEnv = process.env,
  deps: FirstRunSetupDeps = {},
): Promise<FirstRunSetupResult> {
  if ((env.STOCK_CLAW_SKIP_SETUP || "").trim() === "1") {
    return { changed: false, createdFiles: [] };
  }

  const log = deps.log ?? ((message: string) => console.log(message));
  const createdFiles: string[] = [];
  let state = await inspectFirstRunState(env);

  if (state.mcp.kind === "missing") {
    const targetPath = resolveLocalMcpConfigTarget(env);
    await writeTextFile(targetPath, renderEmptyMcpConfig());
    createdFiles.push(targetPath);
    log(`Initialized empty local MCP config at ${targetPath}. Add private MCP servers later if you need them.`);
    state = await inspectFirstRunState(env);
  }

  if (state.mcp.kind === "invalid") {
    throw new Error(
      `Local MCP config is invalid at ${state.mcp.path}. Fix or replace it manually before starting stock-claw.`,
    );
  }

  const needsRequiredSetup = state.llm.kind !== "ready" || state.telegram.kind === "invalid";
  const needsOptionalSetup = state.telegram.kind === "missing";
  if (!needsRequiredSetup && !needsOptionalSetup) {
    return { changed: createdFiles.length > 0, createdFiles };
  }

  const interactive =
    deps.interactive ??
    (env.STOCK_CLAW_FORCE_INTERACTIVE_SETUP?.trim() === "1" ||
      Boolean(process.stdin.isTTY && process.stdout.isTTY));
  if (!interactive) {
    if (needsRequiredSetup) {
      throw new Error(buildNonInteractiveSetupMessage(state));
    }
    return { changed: false, createdFiles: [] };
  }

  const prompter = deps.prompter ?? new ConsoleFirstRunPrompter();
  try {
    log("stock-claw first-run setup");
    log("Local config files stay on this machine and are not meant to be committed.");

    if (state.llm.kind !== "ready") {
      const targetPath = resolveLocalLlmConfigTarget(env);
      if (state.llm.kind === "missing") {
        const configureNow = await prompter.confirm(
          "Create config/llm.local.toml now? Choose no if you want to create it manually from config/llm.local.example.toml.",
          true,
        );
        if (!configureNow) {
          throw new Error(
            "Create config/llm.local.toml from config/llm.local.example.toml and run npm start again.",
          );
        }
      } else if (state.llm.kind === "invalid") {
        const overwrite = await prompter.confirm(
          `The LLM config at ${targetPath} is invalid. Rewrite it now?`,
          true,
        );
        if (!overwrite) {
          throw new Error("Cannot continue without a valid local LLM config.");
        }
      }
      const llmConfig = await promptForLlmConfig(prompter);
      await writeTextFile(targetPath, renderLlmConfig(llmConfig));
      createdFiles.push(targetPath);
      await loadLlmConfig(env);
      log(`Created LLM config at ${targetPath}.`);
    }

    if (state.telegram.kind !== "ready") {
      const targetPath = resolveLocalTelegramConfigTarget(env);
      if (state.telegram.kind === "invalid") {
        const overwrite = await prompter.confirm(
          `The Telegram config at ${targetPath} is invalid. Rewrite it now?`,
          true,
        );
        if (!overwrite) {
          throw new Error("Cannot continue with an invalid Telegram config.");
        }
      }
      const enableTelegram = await prompter.confirm("Enable Telegram integration now?", true);
      if (!enableTelegram) {
        await writeTextFile(targetPath, renderTelegramConfig({ enabled: false }));
        createdFiles.push(targetPath);
        log(`Created disabled Telegram config at ${targetPath}. You can enable it later by editing this file.`);
      } else {
        const botToken = await promptForTelegramToken(prompter, log);
        await writeTextFile(targetPath, renderTelegramConfig({ enabled: true, botToken }));
        createdFiles.push(targetPath);
        log(`Created Telegram config at ${targetPath}.`);
        const pairer = deps.telegramPairer ?? runTelegramPairingSetup;
        await pairer(env, prompter, log);
      }
    }

    const finalState = await inspectFirstRunState(env);
    if (
      finalState.llm.kind !== "ready" ||
      finalState.mcp.kind !== "ready" ||
      finalState.telegram.kind === "invalid"
    ) {
      throw new Error("First-run setup did not produce a usable local configuration.");
    }
    if (createdFiles.length > 0) {
      log("First-run setup complete. Starting stock-claw.");
    }
    return { changed: createdFiles.length > 0, createdFiles };
  } finally {
    await prompter.close();
  }
}

export async function inspectFirstRunState(
  env: NodeJS.ProcessEnv = process.env,
): Promise<FirstRunSetupState> {
  const [llm, mcp, telegram] = await Promise.all([
    inspectLlmStatus(env),
    inspectMcpStatus(env),
    inspectTelegramStatus(env),
  ]);
  return { llm, mcp, telegram };
}

class ConsoleFirstRunPrompter implements FirstRunPrompter {
  private readonly rl = readline.createInterface({ input, output });

  async confirm(message: string, defaultValue = true): Promise<boolean> {
    const suffix = defaultValue ? "Y/n" : "y/N";
    while (true) {
      const answer = (await this.rl.question(`${message} [${suffix}]: `)).trim().toLowerCase();
      if (!answer) {
        return defaultValue;
      }
      if (["y", "yes"].includes(answer)) {
        return true;
      }
      if (["n", "no"].includes(answer)) {
        return false;
      }
    }
  }

  async input(
    message: string,
    options: {
      defaultValue?: string;
      allowEmpty?: boolean;
    } = {},
  ): Promise<string> {
    const suffix = options.defaultValue ? ` [${options.defaultValue}]` : "";
    while (true) {
      const answer = (await this.rl.question(`${message}${suffix}: `)).trim();
      const value = answer || options.defaultValue || "";
      if (value || options.allowEmpty) {
        return value;
      }
    }
  }

  async close(): Promise<void> {
    this.rl.close();
  }
}

async function inspectLlmStatus(env: NodeJS.ProcessEnv): Promise<SetupStatus> {
  const filePath = resolveLocalLlmConfigTarget(env);
  try {
    await loadLlmConfig(env);
    return { kind: "ready", path: (await resolveLlmConfigPath()) ?? filePath };
  } catch (error) {
    if (await fileExists(filePath)) {
      return {
        kind: "invalid",
        path: filePath,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
    return { kind: "missing", path: filePath };
  }
}

async function inspectMcpStatus(env: NodeJS.ProcessEnv): Promise<SetupStatus> {
  const resolvedPath = await resolveMcpConfigPath(env);
  try {
    await loadMcpServers(env);
    return { kind: "ready", path: resolvedPath };
  } catch (error) {
    if (await fileExists(resolvedPath)) {
      return {
        kind: "invalid",
        path: resolvedPath,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
    return { kind: "missing", path: resolveLocalMcpConfigTarget(env) };
  }
}

async function inspectTelegramStatus(env: NodeJS.ProcessEnv): Promise<SetupStatus> {
  const filePath = resolveLocalTelegramConfigTarget(env);
  if (!(await fileExists(filePath))) {
    return { kind: "missing", path: filePath };
  }
  try {
    const config = await loadTelegramConfig(env);
    if (!config) {
      return { kind: "missing", path: filePath };
    }
    return { kind: "ready", path: (await resolveTelegramConfigPath(env)) ?? filePath };
  } catch (error) {
    return {
      kind: "invalid",
      path: filePath,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function promptForTelegramToken(
  prompter: FirstRunPrompter,
  log: (message: string) => void,
): Promise<string> {
  while (true) {
    const token = await prompter.input("Telegram bot token");
    try {
      await new TelegramHttpBotApi(token).getMe();
      return token;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const keepAnyway = await prompter.confirm(
        `Telegram token validation failed (${detail}). Save this token anyway?`,
        false,
      );
      if (keepAnyway) {
        log("Saving Telegram token without a successful validation check.");
        return token;
      }
    }
  }
}

async function promptForLlmConfig(prompter: FirstRunPrompter): Promise<{
  modelId: string;
  baseUrl: string;
  apiKey: string;
}> {
  const modelId = await prompter.input("LLM model id", { defaultValue: "gpt-4.1-mini" });
  const baseUrl = await prompter.input("LLM base URL", { defaultValue: "https://api.openai.com/v1" });
  const apiKey = await prompter.input("LLM API key");
  return {
    modelId,
    baseUrl,
    apiKey,
  };
}

export async function describeConfiguredSetup(env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  const [llmConfig, llmPath, mcpServers, mcpPath, telegramConfig, telegramPath] = await Promise.all([
    loadLlmConfig(env),
    resolveLlmConfigPath(),
    loadMcpServers(env),
    resolveMcpConfigPath(env),
    loadTelegramConfig(env),
    resolveTelegramConfigPath(env),
  ]);

  const llmHost = formatHost(llmConfig.endpoint.baseUrl);
  const telegramStatus = telegramConfig?.enabled
    ? telegramConfig.adminChatId
      ? "enabled and paired"
      : "enabled"
    : "disabled";

  return [
    "Local config ready:",
    `- LLM: ${llmConfig.chat.model} via ${llmHost} (${llmPath ?? "config/llm.local.toml"})`,
    `- MCP: ${mcpServers.length} server${mcpServers.length === 1 ? "" : "s"} configured (${mcpPath})`,
    `- Telegram: ${telegramStatus}${telegramPath ? ` (${telegramPath})` : ""}`,
  ];
}

async function runTelegramPairingSetup(
  env: NodeJS.ProcessEnv,
  prompter: FirstRunPrompter,
  log: (message: string) => void,
): Promise<void> {
  const config = await loadTelegramConfig(env);
  if (!config?.enabled) {
    return;
  }
  const runtimeStub = {
    getOrchestrator: async () => {
      throw new Error("stock-claw setup is waiting for Telegram pairing and cannot process chat requests yet.");
    },
    inspect: async () => ({
      status: {
        startedAt: null,
        lastReloadAt: null,
        lastReloadReason: null,
        reloadCount: 0,
        reloadInFlight: false,
        pendingReason: null,
        lastError: null,
      },
      cron: {
        enabled: false,
        jobCount: 0,
        activeJobCount: 0,
        runningJobCount: 0,
        lastTickAt: null,
      },
      skills: [],
      mcp: [],
      recentMemory: [],
    }),
  } as never;
  const telegram = new TelegramExtension(config, runtimeStub);
  await telegram.start();
  try {
    log("Telegram pairing helper is running.");
    log("Send any message to your bot in Telegram. The bot will reply with a pairing code.");
    log("Then paste the pairing code here directly. Type 'skip' to continue later.");
    while (true) {
      const code = (await prompter.input("Telegram pairing code", { allowEmpty: false })).trim();
      if (!code) {
        continue;
      }
      if (code.toLowerCase() === "skip") {
        log("Skipping Telegram pairing for now.");
        return;
      }
      if (code.toLowerCase() === "pending") {
        const pending = await telegram.listPendingPairings();
        if (!pending.length) {
          log("No pending Telegram pairing requests have been detected yet.");
          continue;
        }
        log("Pending Telegram pairing requests:");
        for (const entry of pending) {
          log(`- ${entry.code} chat=${entry.chatId} user=${entry.username ?? entry.userId}`);
        }
        continue;
      }
      const approved = await telegram.approvePairingCode(code, "setup-wizard");
      if (!approved) {
        log(`No pending pairing request found for code ${code.toUpperCase()}.`);
        continue;
      }
      log(
        `Approved Telegram chat ${approved.chatId} (${approved.username ? `@${approved.username}` : approved.userId}).`,
      );
      return;
    }
  } finally {
    await telegram.close();
  }
}

function renderEmptyMcpConfig(): string {
  return `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`;
}

function renderTelegramConfig(params: { enabled: boolean; botToken?: string }): string {
  return `${JSON.stringify(
    {
      enabled: params.enabled,
      botToken: params.enabled ? params.botToken || "" : "",
      adminChatId: "",
      pollingTimeoutSeconds: 20,
      pollingIntervalMs: 1000,
      pairing: {
        enabled: true,
        notifyAdmin: true,
      },
    },
    null,
    2,
  )}\n`;
}

function renderLlmConfig(params: {
  modelId: string;
  baseUrl: string;
  apiKey: string;
}): string {
  return [
    "[llm]",
    `model = ${toTomlString(params.modelId)}`,
    `baseUrl = ${toTomlString(params.baseUrl)}`,
    `apiKey = ${toTomlString(params.apiKey)}`,
    "",
  ].join("\n");
}

function toTomlString(value: string): string {
  return JSON.stringify(value);
}

async function writeTextFile(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function resolveLocalLlmConfigTarget(env: NodeJS.ProcessEnv): string {
  return path.resolve("config/llm.local.toml");
}

function resolveLocalTelegramConfigTarget(env: NodeJS.ProcessEnv): string {
  return path.resolve(env.STOCK_CLAW_TELEGRAM_CONFIG_PATH?.trim() || "config/telegram.json");
}

function resolveLocalMcpConfigTarget(env: NodeJS.ProcessEnv): string {
  return path.resolve(env.STOCK_CLAW_MCP_CONFIG_PATH?.trim() || "config/mcporter.json");
}

function buildNonInteractiveSetupMessage(state: FirstRunSetupState): string {
  const problems = [state.telegram, state.llm].filter(
    (entry) => entry.kind !== "ready" && !(entry === state.telegram && entry.kind === "missing"),
  );
  const lines = [
    "stock-claw cannot start because required local configuration is missing or invalid.",
    "",
    ...problems.map((entry) =>
      `- ${entry.path}: ${entry.kind}${entry.detail ? ` (${entry.detail})` : ""}`,
    ),
    "",
    "Create config/llm.local.toml from config/llm.local.example.toml and run npm start again.",
  ];
  return lines.join("\n");
}

function formatHost(value: string): string {
  try {
    return new URL(value).host || value;
  } catch {
    return value;
  }
}
