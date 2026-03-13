import path from "node:path";

import type { RuntimeManager } from "../runtime/manager.js";
import type { UserRequest } from "../types.js";
import type { TelegramConfig } from "./config.js";
import { setTelegramAdminChatId } from "./config.js";
import type {
  TelegramBotApi,
  TelegramBotCommand,
  TelegramDocumentOptions,
  TelegramMessage,
  TelegramReactionTypeEmoji,
  TelegramUpdate,
  TelegramUser,
} from "./bot-api.js";
import { TelegramHttpBotApi } from "./bot-api.js";
import { TelegramPairingStore } from "./pairing-store.js";
import { TelegramPollerLock } from "./poller-lock.js";
import { TelegramStateStore } from "../state/telegram-state-store.js";
import { resolveTelegramDownloadFileName, saveTelegramDownloadedFile } from "./downloads.js";
import { renderTelegramHtml, splitTelegramMessage } from "./format.js";
import { normalizeTelegramInboundMessage } from "./inbound.js";
import {
  buildAdminPairingNotice,
  buildBacktestJobsMessage,
  buildCronJobsMessage,
  buildMemoryArtifactsMessage,
  buildPairingReply,
  buildPendingListMessage,
  buildPortfolioMessage,
  buildRuntimeMessage,
  buildStatusMessage,
  buildSpawnHistoryMessage,
} from "./messages.js";

export class TelegramExtension {
  private readonly api: TelegramBotApi;
  private readonly pairing: TelegramPairingStore;
  private readonly state: TelegramStateStore;
  private readonly downloadRoot: string;
  private readonly abort = new AbortController();
  private readonly pollerLock: {
    acquire(): Promise<{ acquired: boolean; holderPid: number | null }>;
    release(): Promise<void>;
  };
  private loop: Promise<void> | null = null;
  private offset = 0;
  private botUser: TelegramUser | null = null;
  private consecutiveFailures = 0;
  private lastFailureMessage = "";
  private lastFailureLoggedAt = 0;

  constructor(
    private readonly config: TelegramConfig,
    private readonly runtime: RuntimeManager,
    options: {
      api?: TelegramBotApi;
      pairing?: TelegramPairingStore;
      state?: TelegramStateStore;
      pollerLock?: {
        acquire(): Promise<{ acquired: boolean; holderPid: number | null }>;
        release(): Promise<void>;
      };
      downloadRoot?: string;
    } = {},
  ) {
    this.api = options.api ?? new TelegramHttpBotApi(config.botToken);
    this.pairing = options.pairing ?? new TelegramPairingStore();
    this.state = options.state ?? new TelegramStateStore();
    this.pollerLock = options.pollerLock ?? new TelegramPollerLock();
    this.downloadRoot = options.downloadRoot ?? path.resolve("data/telegram-downloads");
  }

  async start(): Promise<void> {
    if (!this.config.enabled || this.loop) {
      return;
    }
    await this.bootstrapBotApi();
    const lock = await this.pollerLock.acquire();
    if (!lock.acquired) {
      console.warn(
        `stock-claw telegram polling skipped: another local instance already owns the bot polling lock (pid ${lock.holderPid}).`,
      );
      return;
    }
    this.offset = await this.state.readLastUpdateId();
    this.loop = this.run().catch((error) => {
      console.warn(`stock-claw telegram loop stopped: ${String(error)}`);
    });
  }

  private async bootstrapBotApi(): Promise<void> {
    try {
      this.botUser = await this.api.getMe();
    } catch (error) {
      console.warn(
        `stock-claw telegram bootstrap warning: getMe failed (${formatTelegramBootstrapError(error)}). Continuing without bot identity preload.`,
      );
    }

    try {
      await this.registerCommands();
    } catch (error) {
      console.warn(
        `stock-claw telegram bootstrap warning: setMyCommands failed (${formatTelegramBootstrapError(error)}). Telegram polling will continue.`,
      );
    }
  }

  async close(): Promise<void> {
    this.abort.abort();
    await this.loop;
    this.loop = null;
    await this.pollerLock.release();
  }

  async listPendingPairings() {
    return this.pairing.listPending();
  }

  async approvePairingCode(code: string, approvedBy = "local-console") {
    const approved = await this.pairing.approveByCode({ code, approvedBy });
    if (!approved) {
      return null;
    }
    if (!this.config.adminChatId) {
      await setTelegramAdminChatId(approved.chatId);
      this.config.adminChatId = approved.chatId;
      await this.registerCommands();
    }
    await this.sendLongMessage(
      approved.chatId,
      "Your Telegram access has been approved. You can now chat with stock-claw.",
    );
    return approved;
  }

  async sendSystemNotice(sessionId: string, message: string): Promise<void> {
    const chatId = sessionId.startsWith("telegram:") ? sessionId.slice("telegram:".length) : sessionId;
    await this.sendLongMessage(chatId, message);
  }

  async sendSessionReaction(
    sessionId: string,
    payload: { messageId: number; emoji: string; isBig?: boolean },
  ): Promise<{ sessionId: string; chatId: string; messageId: number; emoji: string }> {
    if (!sessionId.startsWith("telegram:")) {
      throw new Error("Telegram reactions require a telegram session.");
    }
    if (!this.api.setMessageReaction) {
      throw new Error("Telegram reactions are unavailable.");
    }
    const chatId = sessionId.slice("telegram:".length);
    await this.api.setMessageReaction(chatId, payload.messageId, [toEmojiReaction(payload.emoji)], {
      isBig: payload.isBig,
    });
    return {
      sessionId,
      chatId,
      messageId: payload.messageId,
      emoji: payload.emoji,
    };
  }

  async sendSessionFile(
    sessionId: string,
    payload: { fileName: string; content: string; caption?: string; mimeType?: string },
  ): Promise<{ sessionId: string; chatId: string; fileName: string }> {
    if (!sessionId.startsWith("telegram:")) {
      throw new Error("Telegram file delivery requires a telegram session.");
    }
    if (!this.api.sendDocument) {
      throw new Error("Telegram document delivery is unavailable.");
    }
    const chatId = sessionId.slice("telegram:".length);
    const fileName = normalizeTelegramFileName(payload.fileName);
    const options: TelegramDocumentOptions = {
      mimeType: resolveTelegramDocumentMimeType(fileName, payload.mimeType),
      ...(payload.caption?.trim()
        ? {
            caption: renderTelegramHtml(payload.caption),
            parseMode: "HTML",
          }
        : {}),
    };
    await this.api.sendDocument(
      chatId,
      {
        fileName,
        content: payload.content,
      },
      options,
    );
    return { sessionId, chatId, fileName };
  }

  async downloadSessionAttachment(
    sessionId: string,
    payload: {
      messageId: number;
      attachmentIndex?: number;
      fileName?: string;
      requestMetadata?: Record<string, unknown>;
    },
  ): Promise<{
    sessionId: string;
    chatId: string;
    messageId: number;
    attachmentIndex: number;
    fileName: string;
    savedPath: string;
    bytes: number;
  }> {
    if (!sessionId.startsWith("telegram:")) {
      throw new Error("Telegram attachment download requires a telegram session.");
    }
    if (!this.api.getFile || !this.api.downloadFile) {
      throw new Error("Telegram attachment download is unavailable.");
    }
    const chatId = sessionId.slice("telegram:".length);
    const attachments = readTelegramAttachmentArray(payload.requestMetadata?.telegramAttachments);
    if (!attachments.length) {
      throw new Error("No downloadable Telegram attachments were recorded for the current message.");
    }
    const attachmentIndex = payload.attachmentIndex ?? 0;
    const attachment = attachments[attachmentIndex];
    if (!attachment) {
      throw new Error(`Telegram attachment index ${attachmentIndex} was not found on the current message.`);
    }
    if (!attachment.fileId) {
      throw new Error(`Telegram attachment index ${attachmentIndex} does not expose a downloadable file.`);
    }
    const telegramFile = await this.api.getFile(attachment.fileId);
    if (!telegramFile.file_path) {
      throw new Error(`Telegram did not return a file path for attachment index ${attachmentIndex}.`);
    }
    const content = await this.api.downloadFile(telegramFile.file_path);
    const fileName = resolveTelegramDownloadFileName({
      requestedFileName: payload.fileName,
      attachmentKind: attachment.kind,
      attachmentFileName: attachment.fileName,
      attachmentMimeType: attachment.mimeType,
      filePath: telegramFile.file_path,
    });
    const saved = await saveTelegramDownloadedFile({
      rootDir: this.downloadRoot,
      chatId,
      messageId: payload.messageId,
      fileName,
      content,
    });
    return {
      sessionId,
      chatId,
      messageId: payload.messageId,
      attachmentIndex,
      fileName: saved.fileName,
      savedPath: saved.savedPath,
      bytes: saved.bytes,
    };
  }

  private async run(): Promise<void> {
    while (!this.abort.signal.aborted) {
      try {
        const updates = await this.api.getUpdates(
          this.offset,
          this.config.pollingTimeoutSeconds,
          this.abort.signal,
        );
        for (const update of updates) {
          this.offset = Math.max(this.offset, update.update_id + 1);
          await this.state.writeLastUpdateId(this.offset);
          await this.processUpdate(update);
        }
        this.consecutiveFailures = 0;
      } catch (error) {
        if (this.abort.signal.aborted) {
          return;
        }
        this.consecutiveFailures += 1;
        this.logPollingError(error);
      }
      await sleep(this.nextPollDelayMs());
    }
  }

  private async processUpdate(update: TelegramUpdate): Promise<void> {
    const message = update.message;
    const inbound = message ? normalizeTelegramInboundMessage(message) : null;
    if (!message || !inbound) {
      return;
    }
    if (message.chat.type !== "private" || !message.from) {
      return;
    }
    const text = message.text?.trim() || "";
    const chatId = String(message.chat.id);
    const userId = String(message.from.id);
    const username = message.from.username ?? null;

    await this.tryReactToIncomingMessage(chatId, message.message_id, "👀");

    if (this.isAdminChat(chatId) && (await this.handleAdminCommand(message, chatId))) {
      return;
    }

    if (this.config.pairing.enabled && !(await this.pairing.isApproved(userId)) && !this.isAdminChat(chatId)) {
      const pairing = await this.pairing.upsertPending({ userId, chatId, username });
      await this.sendLongMessage(
        chatId,
        buildPairingReply({
          code: pairing.code,
        }),
      );
      if (pairing.created && this.config.pairing.notifyAdmin && this.config.adminChatId) {
        await this.sendLongMessage(
          this.config.adminChatId,
          buildAdminPairingNotice({
            code: pairing.code,
            username,
            userId,
          }),
        );
      }
      if (pairing.created) {
        console.log(
          `stock-claw telegram pairing pending: code=${pairing.code} user=${username ? `@${username}` : userId} chat=${chatId}`,
        );
        console.log(`paste this pairing code into the local stock-claw console: ${pairing.code}`);
      }
      return;
    }

    if (await this.handleRuntimeCommand(message, chatId)) {
      return;
    }

    await this.runWithTyping(chatId, async () => {
      const orchestrator = await this.runtime.getOrchestrator();
      const sessionId = `telegram:${chatId}`;
      await orchestrator.createSession({
        sessionId,
        userId: `telegram:${userId}`,
        channel: "telegram",
      });
      const result = await orchestrator.handle({
        requestId: `${update.update_id}`,
        channel: "telegram",
        userId: `telegram:${userId}`,
        sessionId,
        message: inbound.message,
        timestamp: new Date(message.date * 1000).toISOString(),
        metadata: {
          chatId,
          messageId: message.message_id,
          telegramMessageId: message.message_id,
          telegramUsername: username,
          ...inbound.metadata,
        },
      } satisfies UserRequest);
      await this.sendLongMessage(chatId, result.response.message);
    });
  }

  private async handleAdminCommand(message: TelegramMessage, chatId: string): Promise<boolean> {
    const text = message.text?.trim() || "";
    if (!text.startsWith("/")) {
      return false;
    }
    const [command] = text.split(/\s+/, 2);
    if (command === "/pending") {
      const pending = await this.pairing.listPending();
      await this.sendLongMessage(chatId, buildPendingListMessage(pending.map((entry) => entry.code)));
      return true;
    }
    return false;
  }

  private async handleRuntimeCommand(
    message: TelegramMessage,
    chatId: string,
  ): Promise<boolean> {
    const text = message.text?.trim() || "";
    if (!text.startsWith("/")) {
      return false;
    }
    const command = text.split(/\s+/, 1)[0]?.toLowerCase() || "";
    if (command === "/portfolio" || command === "/profolio") {
      await this.runWithTyping(chatId, async () => {
        const orchestrator = await this.runtime.getOrchestrator();
        const payload = await orchestrator.getPortfolioPayload();
        await this.sendLongMessage(
          chatId,
          buildPortfolioMessage({
            accountId: payload.snapshot.accountId,
            mode: payload.snapshot.mode,
            cash: payload.snapshot.cash,
            equity: payload.snapshot.equity,
            buyingPower: payload.snapshot.buyingPower,
            updatedAt: payload.snapshot.updatedAt,
            positions: payload.snapshot.positions,
          }),
        );
      });
      return true;
    }
    if (command === "/status") {
      await this.runWithTyping(chatId, async () => {
        const orchestrator = await this.runtime.getOrchestrator();
        const sessionId = `telegram:${chatId}`;
        const session = await orchestrator.getSessionStatus(sessionId);
        const runtime = this.isAdminChat(chatId) ? await this.runtime.inspect() : null;
        await this.sendLongMessage(chatId, buildStatusMessage({ session, runtime }));
      });
      return true;
    }
    if (command === "/backtests") {
      await this.runWithTyping(chatId, async () => {
        const orchestrator = await this.runtime.getOrchestrator();
        const sessionId = `telegram:${chatId}`;
        const snapshot = await orchestrator.getSessionBacktests(sessionId);
        await this.sendLongMessage(
          chatId,
          buildBacktestJobsMessage({
            sessionId,
            counts: snapshot.counts,
            jobs: snapshot.jobs.map((job) => ({
              jobId: job.jobId,
              status: job.status,
              symbols: [...job.symbols],
              dateFrom: job.dateFrom,
              dateTo: job.dateTo,
              submittedAt: job.submittedAt,
              reportSummary: job.reportSummary,
              error: job.error,
              deliveredAt: job.deliveredAt,
            })),
          }),
        );
      });
      return true;
    }
    if (!this.isAdminChat(chatId)) {
      return false;
    }
    if (command === "/runtime") {
      await this.runWithTyping(chatId, async () => {
        const payload = await this.runtime.inspect();
        await this.sendLongMessage(
          chatId,
          buildRuntimeMessage({
            ...payload.status,
            cron: payload.cron,
            mcp: payload.mcp,
            skills: payload.skills.map((skill) => ({ name: skill.name })),
          }),
        );
      });
      return true;
    }
    if (command === "/spawns") {
      await this.runWithTyping(chatId, async () => {
        const orchestrator = await this.runtime.getOrchestrator();
        const sessionId = `telegram:${chatId}`;
        const spawns = await orchestrator.getSessionSpawns(sessionId);
        await this.sendLongMessage(
          chatId,
          buildSpawnHistoryMessage({
            sessionId,
            spawns: spawns.map((spawn) => ({
              role: spawn.role,
              sessionId: spawn.sessionId,
              toolCalls: spawn.toolCalls ?? [],
            })),
          }),
        );
      });
      return true;
    }
    if (command === "/memory") {
      await this.runWithTyping(chatId, async () => {
        const payload = await this.runtime.inspect();
        await this.sendLongMessage(
          chatId,
          buildMemoryArtifactsMessage(
            payload.recentMemory.map((artifact) => ({
              fileName: artifact.fileName,
              category: artifact.category,
              updatedAt: artifact.updatedAt,
            })),
          ),
        );
      });
      return true;
    }
    if (command === "/cron") {
      await this.runWithTyping(chatId, async () => {
        const orchestrator = await this.runtime.getOrchestrator();
        const payload = await orchestrator.inspectCron();
        if (!payload) {
          await this.sendLongMessage(chatId, "Cron service is unavailable.");
          return;
        }
        await this.sendLongMessage(
          chatId,
          buildCronJobsMessage({
            enabled: payload.status.enabled,
            jobs: payload.jobs.map((job) => ({
              id: job.id,
              name: job.name,
              enabled: job.enabled,
              nextRunAt: job.state.nextRunAt,
              lastOutcome: job.state.lastOutcome,
            })),
          }),
        );
      });
      return true;
    }
    if (command === "/restart") {
      await this.runWithTyping(chatId, async () => {
        const orchestrator = await this.runtime.getOrchestrator();
        const sessionId = `telegram:${chatId}`;
        const result = await orchestrator.requestRestart({
          sessionId,
          channel: "telegram",
          note: "stock-claw restarted successfully. You can continue in this same chat.",
          reason: "telegram-admin",
        });
        await this.sendLongMessage(chatId, result?.message || "Restart controller unavailable.");
      });
      return true;
    }
    return false;
  }

  private isAdminChat(chatId: string): boolean {
    return Boolean(this.config.adminChatId && this.config.adminChatId === chatId);
  }

  private nextPollDelayMs(): number {
    if (this.consecutiveFailures <= 0) {
      return this.config.pollingIntervalMs;
    }
    return Math.min(this.config.pollingIntervalMs * 2 ** Math.min(this.consecutiveFailures, 5), 30_000);
  }

  private logPollingError(error: unknown): void {
    const message = String(error);
    const now = Date.now();
    const shouldLog =
      this.lastFailureMessage !== message ||
      now - this.lastFailureLoggedAt > 30_000 ||
      this.consecutiveFailures <= 2;
    if (shouldLog) {
      const detail = message.includes("409")
        ? `${message} Another getUpdates poll is active for this bot token. Stop duplicate stock-claw instances or let only one process own Telegram polling.`
        : message;
      console.warn(`stock-claw telegram polling error: ${detail}`);
      this.lastFailureMessage = message;
      this.lastFailureLoggedAt = now;
    }
  }

  private async sendLongMessage(chatId: string, message: string): Promise<void> {
    for (const chunk of splitTelegramMessage(message)) {
      await this.api.sendMessage(chatId, renderTelegramHtml(chunk), {
        parseMode: "HTML",
        disableWebPagePreview: true,
      });
    }
  }

  private async runWithTyping<T>(chatId: string, work: () => Promise<T>): Promise<T> {
    const timer = setInterval(() => {
      void this.api.sendChatAction(chatId, "typing").catch(() => {});
    }, 4000);
    try {
      await this.api.sendChatAction(chatId, "typing");
      return await work();
    } finally {
      clearInterval(timer);
    }
  }

  private async tryReactToIncomingMessage(chatId: string, messageId: number, emoji: string): Promise<void> {
    if (!this.api.setMessageReaction) {
      return;
    }
    try {
      await this.api.setMessageReaction(chatId, messageId, [toEmojiReaction(emoji)]);
    } catch (error) {
      console.warn(`stock-claw telegram reaction warning: ${formatTelegramBootstrapError(error)}`);
    }
  }

  private async registerCommands(): Promise<void> {
    const publicCommands: TelegramBotCommand[] = [
      { command: "status", description: "Show current session status and context usage" },
      { command: "backtests", description: "Show full backtest job history for this chat" },
      { command: "portfolio", description: "Show the current paper portfolio snapshot" },
      { command: "new", description: "Archive and reset the current chat session" },
      { command: "reset", description: "Reset the current chat session" },
    ];
    await this.api.setMyCommands(publicCommands, {
      type: "all_private_chats",
    });

    const adminCommands: TelegramBotCommand[] = [
      ...publicCommands,
      { command: "runtime", description: "Show stock-claw runtime and reload state" },
      { command: "cron", description: "Show scheduled monitoring and reminder jobs" },
      { command: "restart", description: "Restart the stock-claw daemon and recover this chat" },
      { command: "spawns", description: "Show recent spawned subagents for this chat" },
      { command: "memory", description: "Show recent durable memory artifacts" },
      { command: "pending", description: "List pending Telegram pairing requests" },
    ];
    if (this.config.adminChatId) {
      await this.api.setMyCommands(adminCommands, {
        type: "chat",
        chat_id: this.config.adminChatId,
      });
    }
  }
}

export async function createTelegramExtension(
  env: NodeJS.ProcessEnv,
  runtime: RuntimeManager,
): Promise<TelegramExtension | null> {
  const { loadTelegramConfig } = await import("./config.js");
  const config = await loadTelegramConfig(env);
  if (!config?.enabled) {
    return null;
  }
  return new TelegramExtension(config, runtime);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatTelegramBootstrapError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeTelegramFileName(input: string): string {
  const trimmed = input.trim();
  const fileName = trimmed.split(/[\\/]/).at(-1) || "analysis.md";
  const sanitized = fileName.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return sanitized || "analysis.md";
}

function resolveTelegramDocumentMimeType(fileName: string, explicitMimeType?: string): string {
  if (explicitMimeType?.trim()) {
    return explicitMimeType.trim();
  }
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".md")) {
    return "text/markdown; charset=utf-8";
  }
  if (lower.endsWith(".json")) {
    return "application/json; charset=utf-8";
  }
  if (lower.endsWith(".csv")) {
    return "text/csv; charset=utf-8";
  }
  return "text/plain; charset=utf-8";
}

function toEmojiReaction(emoji: string): TelegramReactionTypeEmoji {
  return {
    type: "emoji",
    emoji,
  };
}

function readTelegramAttachmentArray(value: unknown): Array<{
  kind: string;
  fileId?: string;
  fileName?: string;
  mimeType?: string;
}> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isDownloadableTelegramAttachment);
}

function isDownloadableTelegramAttachment(
  value: unknown,
): value is {
  kind: string;
  fileId?: string;
  fileName?: string;
  mimeType?: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.kind === "string";
}
