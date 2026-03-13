import readline from "node:readline";

import type { TelegramExtension } from "./service.js";

export interface TelegramConsoleAdmin {
  close(): Promise<void>;
}

export function createTelegramConsoleAdmin(
  telegram: TelegramExtension | null,
): TelegramConsoleAdmin | null {
  if (!telegram || !process.stdin.isTTY || !process.stdout.isTTY) {
    return null;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "stock-claw> ",
  });

  console.log("Telegram local admin console enabled.");
  console.log("Paste a Telegram pairing code directly to approve that chat.");
  console.log("Type help for extra commands.");
  rl.prompt();

  rl.on("line", (line) => {
    void handleLine(telegram, rl, line);
  });

  return {
    async close() {
      rl.close();
    },
  };
}

async function handleLine(
  telegram: TelegramExtension,
  rl: readline.Interface,
  line: string,
): Promise<void> {
  const trimmed = line.trim();
  if (!trimmed) {
    rl.prompt();
    return;
  }
  const [command, ...rest] = trimmed.split(/\s+/);
  try {
    if (/^[A-Z0-9]{8}$/i.test(trimmed)) {
      const approved = await telegram.approvePairingCode(trimmed);
      if (!approved) {
        console.log(`No pending pairing request found for code ${trimmed.toUpperCase()}.`);
      } else {
        console.log(
          `Approved Telegram chat ${approved.chatId} (${approved.username ? `@${approved.username}` : approved.userId}).`,
        );
      }
      rl.prompt();
      return;
    }
    switch ((command || "").toLowerCase()) {
      case "pending": {
        const pending = await telegram.listPendingPairings();
        if (!pending.length) {
          console.log("No pending Telegram pairing requests.");
        } else {
          console.log("Pending Telegram pairing requests:");
          for (const entry of pending) {
            console.log(
              `- ${entry.code} chat=${entry.chatId} user=${entry.userId} username=${entry.username ?? "(none)"} seen=${entry.lastSeenAt}`,
            );
          }
        }
        break;
      }
      case "approve": {
        const code = rest[0]?.trim();
        if (!code) {
          console.log("Usage: approve <CODE>");
          break;
        }
        const approved = await telegram.approvePairingCode(code);
        if (!approved) {
          console.log(`No pending pairing request found for code ${code.toUpperCase()}.`);
          break;
        }
        console.log(
          `Approved Telegram chat ${approved.chatId} (${approved.username ? `@${approved.username}` : approved.userId}).`,
        );
        break;
      }
      case "help": {
        console.log("Commands: <PAIRING_CODE> | pending | approve <CODE> | help");
        break;
      }
      default:
        console.log("Unknown console command. Paste a pairing code directly or type help.");
    }
  } catch (error) {
    console.log(error instanceof Error ? error.message : String(error));
  }
  rl.prompt();
}
