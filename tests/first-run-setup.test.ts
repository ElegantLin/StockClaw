import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { loadLlmConfig } from "../src/config/llm.js";
import { loadMcpServers } from "../src/config/mcp.js";
import { describeConfiguredSetup, ensureFirstRunSetup, type FirstRunPrompter } from "../src/setup/first-run.js";
import { loadTelegramConfig } from "../src/telegram/config.js";

class TestPrompter implements FirstRunPrompter {
  constructor(
    private readonly confirms: boolean[],
    private readonly inputs: string[],
  ) {}

  async confirm(): Promise<boolean> {
    if (!this.confirms.length) {
      throw new Error("No confirm responses left.");
    }
    return this.confirms.shift() as boolean;
  }

  async input(): Promise<string> {
    if (!this.inputs.length) {
      throw new Error("No input responses left.");
    }
    return this.inputs.shift() as string;
  }

  async close(): Promise<void> {}
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("first-run setup", () => {
  it("creates local mcp, telegram, and llm config files interactively", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-first-run-"));
    const previous = process.cwd();
    process.chdir(dir);
    const env = {
      STOCK_CLAW_MCP_CONFIG_PATH: path.join(dir, "config", "mcporter.json"),
      STOCK_CLAW_TELEGRAM_CONFIG_PATH: path.join(dir, "config", "telegram.json"),
    } as NodeJS.ProcessEnv;
    const pairer = vi.fn(async () => {});
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: { id: 1, username: "stockclawbot" } }),
    })) as unknown as typeof fetch;

    try {
      const result = await ensureFirstRunSetup(env, {
        interactive: true,
        prompter: new TestPrompter(
          [true, true],
          [
            "gpt-4.1-mini",
            "https://api.openai.com/v1",
            "test-api-key",
            "telegram-token",
          ],
        ),
        telegramPairer: pairer,
        log: () => {},
      });

      expect(result.changed).toBe(true);
      expect(result.createdFiles).toHaveLength(3);
      expect(await loadMcpServers(env)).toEqual([]);
      expect(await loadTelegramConfig(env)).toMatchObject({
        enabled: true,
        botToken: "telegram-token",
      });
      expect(await loadLlmConfig(env)).toMatchObject({
        endpoint: {
          baseUrl: "https://api.openai.com/v1",
          apiKey: "test-api-key",
        },
        chat: {
          provider: "openai",
          model: "gpt-4.1-mini",
          contextWindow: 200000,
          compactionThresholdTokens: 160000,
          maxOutputTokens: 2000,
        },
      });
      expect(pairer).toHaveBeenCalledTimes(1);
    } finally {
      process.chdir(previous);
    }
  });

  it("can write a disabled telegram config during setup", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-first-run-"));
    const previous = process.cwd();
    process.chdir(dir);
    const env = {
      STOCK_CLAW_MCP_CONFIG_PATH: path.join(dir, "config", "mcporter.json"),
      STOCK_CLAW_TELEGRAM_CONFIG_PATH: path.join(dir, "config", "telegram.json"),
    } as NodeJS.ProcessEnv;

    try {
      await ensureFirstRunSetup(env, {
        interactive: true,
        prompter: new TestPrompter(
          [true, false],
          ["gpt-4.1-mini", "https://api.openai.com/v1", "test-api-key"],
        ),
        log: () => {},
      });

      expect(await loadTelegramConfig(env)).toMatchObject({
        enabled: false,
        botToken: "",
      });
    } finally {
      process.chdir(previous);
    }
  });

  it("fails with a clear message when required local config is missing in non-interactive mode", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-first-run-"));
    const previous = process.cwd();
    process.chdir(dir);
    const env = {
      STOCK_CLAW_MCP_CONFIG_PATH: path.join(dir, "config", "mcporter.json"),
      STOCK_CLAW_TELEGRAM_CONFIG_PATH: path.join(dir, "config", "telegram.json"),
    } as NodeJS.ProcessEnv;

    try {
      await expect(ensureFirstRunSetup(env, { interactive: false })).rejects.toThrow(
        "stock-claw cannot start because required local configuration is missing or invalid.",
      );
    } finally {
      process.chdir(previous);
    }
  });

  it("lets the user skip interactive LLM setup and create the file manually", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-first-run-"));
    const previous = process.cwd();
    process.chdir(dir);
    const env = {
      STOCK_CLAW_MCP_CONFIG_PATH: path.join(dir, "config", "mcporter.json"),
      STOCK_CLAW_TELEGRAM_CONFIG_PATH: path.join(dir, "config", "telegram.json"),
    } as NodeJS.ProcessEnv;

    try {
      await expect(
        ensureFirstRunSetup(env, {
          interactive: true,
          prompter: new TestPrompter([false], []),
          log: () => {},
        }),
      ).rejects.toThrow("Create config/llm.local.toml from config/llm.local.example.toml");
    } finally {
      process.chdir(previous);
    }
  });

  it("describes already configured local setup", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-first-run-"));
    const previous = process.cwd();
    process.chdir(dir);
    const env = {
      STOCK_CLAW_MCP_CONFIG_PATH: path.join(dir, "config", "mcporter.json"),
      STOCK_CLAW_TELEGRAM_CONFIG_PATH: path.join(dir, "config", "telegram.json"),
    } as NodeJS.ProcessEnv;
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: { id: 1, username: "stockclawbot" } }),
    })) as unknown as typeof fetch;

    try {
      await ensureFirstRunSetup(env, {
        interactive: true,
        prompter: new TestPrompter(
          [true, true],
          ["glm-5", "https://open.bigmodel.cn/api/coding/paas/v4", "test-api-key", "telegram-token"],
        ),
        telegramPairer: vi.fn(async () => {}),
        log: () => {},
      });

      const summary = await describeConfiguredSetup(env);
      expect(summary).toEqual([
        "Local config ready:",
        expect.stringContaining("LLM: glm-5 via open.bigmodel.cn"),
        expect.stringContaining("MCP: 0 servers configured"),
        expect.stringContaining("Telegram: enabled"),
      ]);
    } finally {
      process.chdir(previous);
    }
  });
});
