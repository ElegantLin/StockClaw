import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadLlmConfig } from "../src/config/llm.js";

describe("loadLlmConfig", () => {
  it("loads OpenClaw-style TOML config from config/llm.local.toml", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-llm-"));
    const configDir = path.join(dir, "config");
    await mkdir(configDir, { recursive: true });
    await writeFile(
      path.join(configDir, "llm.local.toml"),
      [
        "[models.providers.glm]",
        'baseUrl = "https://open.bigmodel.cn/api/coding/paas/v4"',
        'apiKeyEnv = "STOCK_CLAW_GLM_KEY"',
        "",
        "[agents.defaults]",
        "timeoutSeconds = 30",
        "contextTokens = 4096",
        "compactionThresholdTokens = 3072",
        "",
        '[agents.defaults.model]',
        'primary = "glm/glm-5"',
        "",
        '[agents.defaults.models."glm/glm-5"]',
        'alias = "glm"',
        "",
        '[agents.defaults.models."glm/glm-5".params]',
        "maxTokens = 1024",
      ].join("\n"),
      "utf8",
    );

    const previous = process.cwd();
    process.chdir(dir);
    try {
      const config = await loadLlmConfig({
        STOCK_CLAW_LLM_PROFILE: "glm",
        STOCK_CLAW_GLM_KEY: "secret",
      });

      expect(config.endpoint.apiKey).toBe("secret");
      expect(config.chat.contextWindow).toBe(4096);
      expect(config.chat.compactionThresholdTokens).toBe(3072);
      expect(config.chat.maxOutputTokens).toBe(1024);
    } finally {
      process.chdir(previous);
    }
  });

  it("loads the simplified single-provider TOML config from config/llm.local.toml", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-llm-simple-"));
    const configDir = path.join(dir, "config");
    await mkdir(configDir, { recursive: true });
    await writeFile(
      path.join(configDir, "llm.local.toml"),
      [
        "[llm]",
        'model = "glm-5"',
        'baseUrl = "https://open.bigmodel.cn/api/coding/paas/v4"',
        'apiKey = "secret"',
      ].join("\n"),
      "utf8",
    );

    const previous = process.cwd();
    process.chdir(dir);
    try {
      const config = await loadLlmConfig({});

      expect(config.endpoint.baseUrl).toBe("https://open.bigmodel.cn/api/coding/paas/v4");
      expect(config.endpoint.apiKey).toBe("secret");
      expect(config.chat.provider).toBe("openai");
      expect(config.chat.model).toBe("glm-5");
      expect(config.chat.contextWindow).toBe(200000);
      expect(config.chat.compactionThresholdTokens).toBe(160000);
      expect(config.chat.maxOutputTokens).toBe(2000);
    } finally {
      process.chdir(previous);
    }
  });

  it("throws a clear error when config/llm.local.toml is missing", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-llm-missing-"));
    const previous = process.cwd();
    process.chdir(dir);
    try {
      await expect(loadLlmConfig({})).rejects.toThrow(
        "Missing required LLM config file: config/llm.local.toml",
      );
    } finally {
      process.chdir(previous);
    }
  });
});
