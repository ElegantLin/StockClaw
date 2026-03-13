import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export interface TelegramDownloadedFile {
  fileName: string;
  savedPath: string;
  bytes: number;
}

export async function saveTelegramDownloadedFile(params: {
  rootDir: string;
  chatId: string;
  messageId: number;
  fileName: string;
  content: Uint8Array;
}): Promise<TelegramDownloadedFile> {
  const safeFileName = sanitizeTelegramDownloadFileName(params.fileName);
  const targetDir = path.resolve(params.rootDir, sanitizePathSegment(params.chatId), String(params.messageId));
  await mkdir(targetDir, { recursive: true });
  const savedPath = path.join(targetDir, safeFileName);
  await writeFile(savedPath, params.content);
  return {
    fileName: safeFileName,
    savedPath,
    bytes: params.content.byteLength,
  };
}

export function resolveTelegramDownloadFileName(params: {
  requestedFileName?: string | null;
  attachmentKind: string;
  attachmentFileName?: string | null;
  attachmentMimeType?: string | null;
  filePath?: string | null;
}): string {
  const explicit = params.requestedFileName?.trim();
  if (explicit) {
    return explicit;
  }
  const preferred = params.attachmentFileName?.trim() || path.posix.basename(params.filePath?.trim() || "");
  if (preferred) {
    return preferred;
  }
  const extension = inferTelegramDownloadExtension(params.attachmentMimeType, params.attachmentKind);
  return `${params.attachmentKind}${extension}`;
}

function inferTelegramDownloadExtension(mimeType: string | null | undefined, kind: string): string {
  const lower = mimeType?.toLowerCase() || "";
  if (lower === "image/jpeg") {
    return ".jpg";
  }
  if (lower === "image/png") {
    return ".png";
  }
  if (lower === "image/webp") {
    return ".webp";
  }
  if (lower === "application/pdf") {
    return ".pdf";
  }
  if (lower === "video/mp4") {
    return ".mp4";
  }
  if (lower === "audio/mpeg") {
    return ".mp3";
  }
  if (lower === "audio/ogg") {
    return ".ogg";
  }
  if (kind === "photo") {
    return ".jpg";
  }
  if (kind === "sticker") {
    return ".webp";
  }
  return ".bin";
}

function sanitizeTelegramDownloadFileName(value: string): string {
  const collapsed = value.trim().split(/[\\/]/).at(-1) || "telegram-file.bin";
  const sanitized = collapsed.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return sanitized || "telegram-file.bin";
}

function sanitizePathSegment(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return sanitized || "unknown";
}
