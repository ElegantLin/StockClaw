import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { TelegramStateStore } from "../src/state/telegram-state-store.js";

describe("TelegramStateStore", () => {
  it("persists and reloads the last processed update id", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-telegram-state-"));
    const file = path.join(dir, "telegram-state.json");
    const store = new TelegramStateStore(file);

    expect(await store.readLastUpdateId()).toBe(0);
    await store.writeLastUpdateId(42);

    const reloaded = new TelegramStateStore(file);
    expect(await reloaded.readLastUpdateId()).toBe(42);
  });
});
