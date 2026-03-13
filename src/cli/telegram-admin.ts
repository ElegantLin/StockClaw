import { clearTelegramAdminChatId, loadTelegramConfig, setTelegramAdminChatId } from "../telegram/config.js";
import { TelegramPairingStore } from "../telegram/pairing-store.js";

async function main(): Promise<void> {
  const [command, arg] = process.argv.slice(2);
  const store = new TelegramPairingStore();
  switch ((command || "").toLowerCase()) {
    case "pending": {
      const pending = await store.listPending();
      if (!pending.length) {
        console.log("No pending Telegram pairing requests.");
        return;
      }
      console.log("Pending Telegram pairing requests:");
      for (const entry of pending) {
        console.log(
          `- ${entry.code} chat=${entry.chatId} user=${entry.userId} username=${entry.username ?? "(none)"} seen=${entry.lastSeenAt}`,
        );
      }
      return;
    }
    case "approve": {
      if (!arg?.trim()) {
        throw new Error("Usage: npm run telegram-admin -- approve <CODE>");
      }
      const approved = await store.approveByCode({
        code: arg,
        approvedBy: "local-console",
      });
      if (!approved) {
        throw new Error(`No pending pairing request found for code ${arg.toUpperCase()}.`);
      }
      const config = await loadTelegramConfig(process.env);
      if (!config) {
        throw new Error("Telegram config file was not found.");
      }
      if (!config.adminChatId) {
        await setTelegramAdminChatId(approved.chatId);
        console.log(`Approved ${approved.userId} and bound admin chat to ${approved.chatId}.`);
        return;
      }
      console.log(`Approved ${approved.userId} for chat ${approved.chatId}.`);
      return;
    }
    case "clear-admin": {
      await clearTelegramAdminChatId();
      console.log("Telegram admin chat id cleared.");
      return;
    }
    default:
      console.log([
        "Telegram admin CLI",
        "",
        "Usage:",
        "  npm run telegram-admin -- pending",
        "  npm run telegram-admin -- approve <CODE>",
        "  npm run telegram-admin -- clear-admin",
      ].join("\n"));
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
