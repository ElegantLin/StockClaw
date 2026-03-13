import type {
  TelegramAnimation,
  TelegramAudio,
  TelegramContact,
  TelegramDocument,
  TelegramLocation,
  TelegramMessage,
  TelegramPhotoSize,
  TelegramSticker,
  TelegramVideo,
  TelegramVoice,
} from "./bot-api.js";

export type TelegramInboundAttachmentKind =
  | "photo"
  | "document"
  | "video"
  | "voice"
  | "audio"
  | "animation"
  | "sticker"
  | "location"
  | "contact";

export interface TelegramInboundAttachment {
  kind: TelegramInboundAttachmentKind;
  summary: string;
  fileId?: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  width?: number;
  height?: number;
  duration?: number;
  emoji?: string;
  latitude?: number;
  longitude?: number;
  phoneNumber?: string;
}

export interface NormalizedTelegramInboundMessage {
  message: string;
  metadata: Record<string, unknown>;
}

export function normalizeTelegramInboundMessage(
  message: TelegramMessage,
): NormalizedTelegramInboundMessage | null {
  const text = message.text?.trim() || "";
  const caption = message.caption?.trim() || "";
  const attachments = collectTelegramAttachments(message);

  if (!text && !caption && attachments.length === 0) {
    return null;
  }

  const normalizedMessage = resolveNormalizedMessage(text, caption, attachments);
  return {
    message: normalizedMessage,
    metadata: {
      telegramHasAttachments: attachments.length > 0,
      telegramCaption: caption || null,
      telegramAttachments: attachments,
    },
  };
}

export function renderTelegramAttachmentContext(metadata: Record<string, unknown>): string {
  const attachments = readAttachmentArray(metadata.telegramAttachments);
  if (!attachments.length) {
    return "";
  }
  const lines = ["Telegram attachment context:"];
  const caption = typeof metadata.telegramCaption === "string" ? metadata.telegramCaption.trim() : "";
  if (caption) {
    lines.push(`- Caption: ${caption}`);
  }
  for (const attachment of attachments) {
    lines.push(`- ${attachment.summary}`);
  }
  return lines.join("\n");
}

function resolveNormalizedMessage(
  text: string,
  caption: string,
  attachments: TelegramInboundAttachment[],
): string {
  if (text) {
    return text;
  }
  if (caption) {
    return caption;
  }
  if (!attachments.length) {
    return "";
  }
  const labels = attachments.map((attachment) => attachment.kind);
  const uniqueLabels = [...new Set(labels)];
  return `The user sent a Telegram message with ${uniqueLabels.join(", ")} attachment${uniqueLabels.length > 1 ? "s" : ""} and no text.`;
}

function collectTelegramAttachments(message: TelegramMessage): TelegramInboundAttachment[] {
  const attachments: TelegramInboundAttachment[] = [];
  const photo = selectLargestPhoto(message.photo);
  if (photo) {
    attachments.push(fromPhoto(photo));
  }
  if (message.document) {
    attachments.push(fromDocument(message.document));
  }
  if (message.video) {
    attachments.push(fromVideo(message.video));
  }
  if (message.voice) {
    attachments.push(fromVoice(message.voice));
  }
  if (message.audio) {
    attachments.push(fromAudio(message.audio));
  }
  if (message.animation) {
    attachments.push(fromAnimation(message.animation));
  }
  if (message.sticker) {
    attachments.push(fromSticker(message.sticker));
  }
  if (message.location) {
    attachments.push(fromLocation(message.location));
  }
  if (message.contact) {
    attachments.push(fromContact(message.contact));
  }
  return attachments;
}

function selectLargestPhoto(photo: TelegramPhotoSize[] | undefined): TelegramPhotoSize | null {
  if (!photo?.length) {
    return null;
  }
  return [...photo].sort((left, right) => {
    const leftArea = left.width * left.height;
    const rightArea = right.width * right.height;
    return rightArea - leftArea;
  })[0] ?? null;
}

function fromPhoto(photo: TelegramPhotoSize): TelegramInboundAttachment {
  return {
    kind: "photo",
    summary: `photo ${photo.width}x${photo.height}${photo.file_size ? `, ${photo.file_size} bytes` : ""}`,
    fileId: photo.file_id,
    width: photo.width,
    height: photo.height,
    fileSize: photo.file_size,
  };
}

function fromDocument(document: TelegramDocument): TelegramInboundAttachment {
  return {
    kind: "document",
    summary: `document ${document.file_name || document.file_id}${document.mime_type ? `, ${document.mime_type}` : ""}`,
    fileId: document.file_id,
    fileName: document.file_name,
    mimeType: document.mime_type,
    fileSize: document.file_size,
  };
}

function fromVideo(video: TelegramVideo): TelegramInboundAttachment {
  return {
    kind: "video",
    summary: `video ${video.width}x${video.height}, ${video.duration}s${video.file_name ? `, ${video.file_name}` : ""}`,
    fileId: video.file_id,
    fileName: video.file_name,
    mimeType: video.mime_type,
    fileSize: video.file_size,
    width: video.width,
    height: video.height,
    duration: video.duration,
  };
}

function fromVoice(voice: TelegramVoice): TelegramInboundAttachment {
  return {
    kind: "voice",
    summary: `voice note ${voice.duration}s${voice.mime_type ? `, ${voice.mime_type}` : ""}`,
    fileId: voice.file_id,
    mimeType: voice.mime_type,
    fileSize: voice.file_size,
    duration: voice.duration,
  };
}

function fromAudio(audio: TelegramAudio): TelegramInboundAttachment {
  const label = [audio.performer, audio.title].filter(Boolean).join(" - ");
  return {
    kind: "audio",
    summary: `audio ${label || audio.file_name || audio.file_id}, ${audio.duration}s`,
    fileId: audio.file_id,
    fileName: audio.file_name,
    mimeType: audio.mime_type,
    fileSize: audio.file_size,
    duration: audio.duration,
  };
}

function fromAnimation(animation: TelegramAnimation): TelegramInboundAttachment {
  return {
    kind: "animation",
    summary: `animation ${animation.width}x${animation.height}, ${animation.duration}s${animation.file_name ? `, ${animation.file_name}` : ""}`,
    fileId: animation.file_id,
    fileName: animation.file_name,
    mimeType: animation.mime_type,
    fileSize: animation.file_size,
    width: animation.width,
    height: animation.height,
    duration: animation.duration,
  };
}

function fromSticker(sticker: TelegramSticker): TelegramInboundAttachment {
  return {
    kind: "sticker",
    summary: `sticker ${sticker.emoji || "(no emoji)"} ${sticker.width}x${sticker.height}${sticker.set_name ? `, set ${sticker.set_name}` : ""}`,
    fileId: sticker.file_id,
    width: sticker.width,
    height: sticker.height,
    emoji: sticker.emoji,
  };
}

function fromLocation(location: TelegramLocation): TelegramInboundAttachment {
  return {
    kind: "location",
    summary: `location ${location.latitude}, ${location.longitude}`,
    latitude: location.latitude,
    longitude: location.longitude,
  };
}

function fromContact(contact: TelegramContact): TelegramInboundAttachment {
  return {
    kind: "contact",
    summary: `contact ${contact.first_name}${contact.last_name ? ` ${contact.last_name}` : ""}, ${contact.phone_number}`,
    phoneNumber: contact.phone_number,
  };
}

function readAttachmentArray(value: unknown): TelegramInboundAttachment[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isTelegramInboundAttachment);
}

function isTelegramInboundAttachment(value: unknown): value is TelegramInboundAttachment {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.kind === "string" && typeof record.summary === "string";
}
