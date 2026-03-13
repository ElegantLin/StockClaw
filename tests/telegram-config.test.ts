import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadTelegramConfig } from "../src/telegram/config.js";

describe("Telegram config", () => {
  it("loads telegram config from a local json file", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-telegram-config-"));
    const file = path.join(dir, "telegram.json");
    await writeFile(
      file,
      JSON.stringify(
        {
          enabled: true,
          botToken: "token",
          adminChatId: "12345",
          pollingTimeoutSeconds: 15,
          pollingIntervalMs: 500,
          pairing: { enabled: true, notifyAdmin: false },
        },
        null,
        2,
      ),
      "utf8",
    );

    const config = await loadTelegramConfig({ STOCK_CLAW_TELEGRAM_CONFIG_PATH: file });
    expect(config).toMatchObject({
      enabled: true,
      botToken: "token",
      adminChatId: "12345",
      pollingTimeoutSeconds: 15,
      pollingIntervalMs: 500,
      pairing: { enabled: true, notifyAdmin: false },
    });
  });

  it("allows a disabled telegram config without a bot token", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-telegram-config-"));
    const file = path.join(dir, "telegram.json");
    await writeFile(
      file,
      JSON.stringify(
        {
          enabled: false,
          botToken: "",
          adminChatId: "",
          pollingTimeoutSeconds: 20,
          pollingIntervalMs: 1000,
          pairing: { enabled: true, notifyAdmin: true },
        },
        null,
        2,
      ),
      "utf8",
    );

    const config = await loadTelegramConfig({ STOCK_CLAW_TELEGRAM_CONFIG_PATH: file });
    expect(config).toMatchObject({
      enabled: false,
      botToken: "",
      adminChatId: null,
    });
  });
});
