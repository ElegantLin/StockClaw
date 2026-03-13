import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { TelegramPairingStore } from "../src/telegram/pairing-store.js";

describe("TelegramPairingStore", () => {
  it("creates pending requests and approves them by code", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "stock-claw-telegram-pairing-"));
    const store = new TelegramPairingStore(path.join(dir, "pairing.json"));

    const pending = await store.upsertPending({
      userId: "100",
      chatId: "100",
      username: "alice",
    });
    expect(pending.created).toBe(true);
    expect(pending.code).toHaveLength(8);

    const approved = await store.approveByCode({
      code: pending.code,
      approvedBy: "admin",
    });
    expect(approved?.userId).toBe("100");
    expect(await store.isApproved("100")).toBe(true);
    expect(await store.listPending()).toHaveLength(0);
  });
});
