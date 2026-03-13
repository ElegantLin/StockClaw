import path from "node:path";

import type { AppSessionRecord } from "../types.js";
import { MemoryService } from "./service.js";
import { buildArchiveSlug, buildSessionSummaryMarkdown } from "./session-summary.js";

function buildSlug(session: AppSessionRecord, timestamp: string): string {
  const base = buildArchiveSlug(session).slice(0, 40);
  const time = timestamp.replace(/[:.]/g, "").replace("T", "-").replace("Z", "").slice(11, 17);
  return `${time}-${base}`;
}

export async function archiveSessionToMemory(params: {
  memory: MemoryService;
  session: AppSessionRecord | null;
  command: "/new" | "/reset";
  timestamp?: string;
}): Promise<string | null> {
  const session = params.session;
  if (!session || session.transcript.length === 0) {
    return null;
  }
  const timestamp = params.timestamp ?? new Date().toISOString();
  const date = timestamp.slice(0, 10);
  const slug = buildSlug(session, timestamp);
  const relativePath = `${date}-${slug}.md`;
  const summary = buildSessionSummaryMarkdown({
    sessionId: session.sessionId,
    transcript: session.transcript,
    lastIntent: session.lastIntent,
    updatedAt: session.updatedAt,
  });
  const content = [
    `# Session Archive ${date}`,
    "",
    `- Session ID: ${session.sessionId}`,
    `- User ID: ${session.userId}`,
    `- Channel: ${session.channel}`,
    `- Trigger: ${params.command}`,
    `- Updated At: ${session.updatedAt}`,
    "",
    "## Summary",
    "",
    ...summary.split("\n"),
    "",
    "## Transcript",
    "",
    ...session.transcript.flatMap((entry) => [
      `### ${entry.role} ${entry.timestamp}`,
      "",
      entry.content.trim() || "(empty)",
      "",
    ]),
  ].join("\n");
  await params.memory.writeDocument(relativePath, content);
  return path.posix.join("memory", relativePath);
}
