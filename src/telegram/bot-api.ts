export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: string;
}

export interface TelegramPhotoSize {
  file_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramDocument {
  file_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramVideo {
  file_id: string;
  width: number;
  height: number;
  duration: number;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramVoice {
  file_id: string;
  duration: number;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramAudio {
  file_id: string;
  duration: number;
  performer?: string;
  title?: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramAnimation {
  file_id: string;
  width: number;
  height: number;
  duration: number;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramSticker {
  file_id: string;
  emoji?: string;
  set_name?: string;
  width: number;
  height: number;
  is_animated?: boolean;
  is_video?: boolean;
}

export interface TelegramLocation {
  latitude: number;
  longitude: number;
}

export interface TelegramContact {
  phone_number: string;
  first_name: string;
  last_name?: string;
  user_id?: number;
}

export interface TelegramMessage {
  message_id: number;
  date: number;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  document?: TelegramDocument;
  video?: TelegramVideo;
  voice?: TelegramVoice;
  audio?: TelegramAudio;
  animation?: TelegramAnimation;
  sticker?: TelegramSticker;
  location?: TelegramLocation;
  contact?: TelegramContact;
  chat: TelegramChat;
  from?: TelegramUser;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export interface TelegramBotCommand {
  command: string;
  description: string;
}

export interface TelegramReactionTypeEmoji {
  type: "emoji";
  emoji: string;
}

export interface TelegramFile {
  file_id: string;
  file_unique_id?: string;
  file_size?: number;
  file_path?: string;
}

export interface TelegramMessageOptions {
  parseMode?: "HTML";
  disableWebPagePreview?: boolean;
}

export interface TelegramDocumentPayload {
  fileName: string;
  content: string;
}

export interface TelegramDocumentOptions {
  caption?: string;
  parseMode?: "HTML";
  mimeType?: string;
}

export interface TelegramBotApi {
  getMe(): Promise<TelegramUser>;
  getUpdates(offset: number, timeoutSeconds: number, signal?: AbortSignal): Promise<TelegramUpdate[]>;
  getFile?(fileId: string): Promise<TelegramFile>;
  downloadFile?(filePath: string): Promise<Uint8Array>;
  sendMessage(chatId: string, text: string, options?: TelegramMessageOptions): Promise<void>;
  setMessageReaction?(
    chatId: string,
    messageId: number,
    reaction: TelegramReactionTypeEmoji[],
    options?: { isBig?: boolean },
  ): Promise<void>;
  sendDocument?(
    chatId: string,
    document: TelegramDocumentPayload,
    options?: TelegramDocumentOptions,
  ): Promise<void>;
  sendChatAction(chatId: string, action: "typing"): Promise<void>;
  setMyCommands(
    commands: TelegramBotCommand[],
    scope?: Record<string, unknown>,
  ): Promise<void>;
}

export class TelegramHttpBotApi implements TelegramBotApi {
  private readonly baseUrl: string;
  private readonly fileBaseUrl: string;

  constructor(private readonly token: string) {
    this.baseUrl = `https://api.telegram.org/bot${token}`;
    this.fileBaseUrl = `https://api.telegram.org/file/bot${token}`;
  }

  async getMe(): Promise<TelegramUser> {
    return this.call<TelegramUser>("getMe");
  }

  async getUpdates(offset: number, timeoutSeconds: number, signal?: AbortSignal): Promise<TelegramUpdate[]> {
    return this.call<TelegramUpdate[]>("getUpdates", {
      offset,
      timeout: timeoutSeconds,
      allowed_updates: ["message"],
    }, signal);
  }

  async getFile(fileId: string): Promise<TelegramFile> {
    return this.call<TelegramFile>("getFile", {
      file_id: fileId,
    });
  }

  async downloadFile(filePath: string): Promise<Uint8Array> {
    const response = await fetch(`${this.fileBaseUrl}/${filePath}`, {
      method: "GET",
    });
    if (!response.ok) {
      throw new Error(`Telegram file download failed with ${response.status}.`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  async sendMessage(chatId: string, text: string, options: TelegramMessageOptions = {}): Promise<void> {
    await this.call("sendMessage", {
      chat_id: chatId,
      text,
      disable_web_page_preview: options.disableWebPagePreview ?? true,
      ...(options.parseMode ? { parse_mode: options.parseMode } : {}),
    });
  }

  async setMessageReaction(
    chatId: string,
    messageId: number,
    reaction: TelegramReactionTypeEmoji[],
    options: { isBig?: boolean } = {},
  ): Promise<void> {
    await this.call("setMessageReaction", {
      chat_id: chatId,
      message_id: messageId,
      reaction,
      ...(options.isBig ? { is_big: true } : {}),
    });
  }

  async sendDocument(
    chatId: string,
    document: TelegramDocumentPayload,
    options: TelegramDocumentOptions = {},
  ): Promise<void> {
    const form = new FormData();
    form.set("chat_id", chatId);
    form.set(
      "document",
      new Blob([document.content], { type: options.mimeType ?? "text/plain; charset=utf-8" }),
      document.fileName,
    );
    if (options.caption) {
      form.set("caption", options.caption);
    }
    if (options.parseMode) {
      form.set("parse_mode", options.parseMode);
    }
    await this.callMultipart("sendDocument", form);
  }

  async sendChatAction(chatId: string, action: "typing"): Promise<void> {
    await this.call("sendChatAction", {
      chat_id: chatId,
      action,
    });
  }

  async setMyCommands(
    commands: TelegramBotCommand[],
    scope?: Record<string, unknown>,
  ): Promise<void> {
    await this.call("setMyCommands", {
      commands,
      ...(scope ? { scope } : {}),
    });
  }

  private async call<T = unknown>(
    method: string,
    body?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}/${method}`, {
      method: body ? "POST" : "GET",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
    if (!response.ok) {
      throw new Error(`Telegram API ${method} failed with ${response.status}.`);
    }
    const payload = (await response.json()) as {
      ok?: boolean;
      result?: T;
      description?: string;
    };
    if (!payload.ok) {
      throw new Error(payload.description || `Telegram API ${method} returned an error.`);
    }
    return payload.result as T;
  }

  private async callMultipart<T = unknown>(
    method: string,
    form: FormData,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}/${method}`, {
      method: "POST",
      body: form,
      signal,
    });
    if (!response.ok) {
      throw new Error(`Telegram API ${method} failed with ${response.status}.`);
    }
    const payload = (await response.json()) as {
      ok?: boolean;
      result?: T;
      description?: string;
    };
    if (!payload.ok) {
      throw new Error(payload.description || `Telegram API ${method} returned an error.`);
    }
    return payload.result as T;
  }
}
