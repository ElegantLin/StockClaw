export interface TelegramFilePayload {
  fileName: string;
  content: string;
  caption?: string;
  mimeType?: string;
}

export interface TelegramReactionPayload {
  messageId: number;
  emoji: string;
  isBig?: boolean;
}

export interface TelegramAttachmentDownloadPayload {
  messageId: number;
  attachmentIndex?: number;
  fileName?: string;
  requestMetadata?: Record<string, unknown>;
}

export interface TelegramDeliveryTarget {
  sendSystemNotice(sessionId: string, message: string): Promise<void>;
  sendSessionReaction?(
    sessionId: string,
    payload: TelegramReactionPayload,
  ): Promise<{
    sessionId: string;
    chatId: string;
    messageId: number;
    emoji: string;
  }>;
  sendSessionFile?(
    sessionId: string,
    payload: TelegramFilePayload,
  ): Promise<{
    sessionId: string;
    chatId: string;
    fileName: string;
  }>;
  downloadSessionAttachment?(
    sessionId: string,
    payload: TelegramAttachmentDownloadPayload,
  ): Promise<{
    sessionId: string;
    chatId: string;
    messageId: number;
    attachmentIndex: number;
    fileName: string;
    savedPath: string;
    bytes: number;
  }>;
}

export class TelegramDeliveryGateway {
  private telegram: TelegramDeliveryTarget | null = null;

  attachTelegram(telegram: TelegramDeliveryTarget | null): void {
    this.telegram = telegram;
  }

  async sendSystemNotice(sessionId: string, message: string): Promise<void> {
    if (!this.telegram) {
      throw new Error("Telegram delivery is unavailable.");
    }
    await this.telegram.sendSystemNotice(sessionId, message);
  }

  async sendSessionReaction(
    sessionId: string,
    payload: TelegramReactionPayload,
  ): Promise<{ sessionId: string; chatId: string; messageId: number; emoji: string }> {
    if (!this.telegram?.sendSessionReaction) {
      throw new Error("Telegram delivery is unavailable.");
    }
    return this.telegram.sendSessionReaction(sessionId, payload);
  }

  async sendSessionFile(
    sessionId: string,
    payload: TelegramFilePayload,
  ): Promise<{ sessionId: string; chatId: string; fileName: string }> {
    if (!this.telegram?.sendSessionFile) {
      throw new Error("Telegram delivery is unavailable.");
    }
    return this.telegram.sendSessionFile(sessionId, payload);
  }

  async downloadSessionAttachment(
    sessionId: string,
    payload: TelegramAttachmentDownloadPayload,
  ): Promise<{
    sessionId: string;
    chatId: string;
    messageId: number;
    attachmentIndex: number;
    fileName: string;
    savedPath: string;
    bytes: number;
  }> {
    if (!this.telegram?.downloadSessionAttachment) {
      throw new Error("Telegram delivery is unavailable.");
    }
    return this.telegram.downloadSessionAttachment(sessionId, payload);
  }
}
