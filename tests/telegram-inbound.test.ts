import { describe, expect, it } from "vitest";

import { normalizeTelegramInboundMessage, renderTelegramAttachmentContext } from "../src/telegram/inbound.js";

describe("normalizeTelegramInboundMessage", () => {
  it("accepts a photo-only telegram message and synthesizes a user request", () => {
    const normalized = normalizeTelegramInboundMessage({
      message_id: 1,
      date: 1,
      chat: { id: 200, type: "private" },
      from: { id: 200, username: "alice" },
      photo: [
        { file_id: "small", width: 90, height: 90 },
        { file_id: "large", width: 1024, height: 768, file_size: 2048 },
      ],
    });

    expect(normalized).not.toBeNull();
    expect(normalized?.message).toContain("photo attachment");
    expect(normalized?.metadata.telegramHasAttachments).toBe(true);
    const attachments = normalized?.metadata.telegramAttachments as Array<{ kind: string; width?: number }>;
    expect(attachments).toHaveLength(1);
    expect(attachments[0]?.kind).toBe("photo");
    expect(attachments[0]?.width).toBe(1024);
  });

  it("keeps a caption as the user request and records attachment context separately", () => {
    const normalized = normalizeTelegramInboundMessage({
      message_id: 2,
      date: 1,
      chat: { id: 200, type: "private" },
      from: { id: 200, username: "alice" },
      caption: "Please review this report",
      document: {
        file_id: "doc-1",
        file_name: "report.pdf",
        mime_type: "application/pdf",
      },
    });

    expect(normalized?.message).toBe("Please review this report");
    expect(renderTelegramAttachmentContext(normalized?.metadata || {})).toContain("document report.pdf");
  });
});
