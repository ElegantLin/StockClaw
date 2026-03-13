import path from "node:path";

import type { AppSessionRecord, ConversationMessage, SessionTranscriptEntry } from "../types.js";
import { MemoryService } from "./service.js";

const PREFERENCE_PATTERN =
  /(不要|不碰|避免|偏好|只做|preferred|prefer|only|avoid|exclude|排除|关注|watch|观察)/i;
const RISK_PATTERN =
  /(仓位|风险|回撤|限制|max|止损|concentration|drawdown|position size|limit)/i;
const TRADE_PATTERN =
  /(buy|sell|买入|卖出|建仓|平仓|加仓|减仓|hold|观望|watchlist|待执行|pending trade)/i;
const KNOWLEDGE_PATTERN = /(策略|原则|框架|纪律|strategy|principle|framework)/i;

export interface SessionInsightSummary {
  preferences: string[];
  constraints: string[];
  pendingTrades: string[];
  knowledge: string[];
  conclusions: string[];
}

export function extractSessionInsights(params: {
  userText?: string;
  assistantText?: string;
  transcript?: Array<ConversationMessage | SessionTranscriptEntry>;
}): SessionInsightSummary {
  const transcript = (params.transcript || []).map((entry) => ({
    role: entry.role,
    content: entry.content,
  }));
  const allUserText = [params.userText || "", ...transcript.filter((item) => item.role === "user").map((item) => item.content)]
    .join("\n");
  const allAssistantText = [
    params.assistantText || "",
    ...transcript.filter((item) => item.role === "assistant").map((item) => item.content),
  ].join("\n");

  return {
    preferences: dedupe(extractMatchingLines(allUserText, PREFERENCE_PATTERN)),
    constraints: dedupe(extractMatchingLines(allUserText, RISK_PATTERN)),
    pendingTrades: dedupe(extractMatchingLines(allUserText, TRADE_PATTERN)),
    knowledge: dedupe(extractMatchingLines(allAssistantText, KNOWLEDGE_PATTERN)),
    conclusions: dedupe(extractConclusionLines(allAssistantText)),
  };
}

export function buildSessionSummaryMarkdown(params: {
  sessionId: string;
  transcript: Array<ConversationMessage | SessionTranscriptEntry>;
  lastIntent?: string | null;
  updatedAt?: string;
}): string {
  const insights = extractSessionInsights({ transcript: params.transcript });
  const lines = [
    `# Live Session Summary`,
    "",
    `- Session ID: ${params.sessionId}`,
    `- Last Intent: ${params.lastIntent || "unknown"}`,
    `- Updated At: ${params.updatedAt || new Date().toISOString()}`,
    "",
    "## Durable User Preferences",
    "",
    ...renderBullets(insights.preferences, "No durable preferences captured yet."),
    "",
    "## Risk And Portfolio Constraints",
    "",
    ...renderBullets(insights.constraints, "No durable constraints captured yet."),
    "",
    "## Pending Trade Intentions",
    "",
    ...renderBullets(insights.pendingTrades, "No pending trade intentions captured yet."),
    "",
    "## Durable Knowledge",
    "",
    ...renderBullets(insights.knowledge, "No durable knowledge captured yet."),
    "",
    "## Recent Conclusions",
    "",
    ...renderBullets(insights.conclusions, "No recent conclusions captured yet."),
  ];
  return lines.join("\n");
}

export async function writeLiveSessionSummary(params: {
  memory: MemoryService;
  sessionId: string;
  transcript: Array<ConversationMessage | SessionTranscriptEntry>;
  lastIntent?: string | null;
  updatedAt?: string;
}): Promise<{ relativePath: string; markdown: string }> {
  const relativePath = buildLiveSessionSummaryPath(params.sessionId);
  const markdown = buildSessionSummaryMarkdown({
    sessionId: params.sessionId,
    transcript: params.transcript,
    lastIntent: params.lastIntent,
    updatedAt: params.updatedAt,
  });
  await params.memory.writeDocument(relativePath, markdown);
  return { relativePath, markdown };
}

export function buildLiveSessionSummaryPath(sessionId: string): string {
  return path.posix.join("sessions", "live", `${safeSessionId(sessionId)}.md`);
}

export async function syncAppSessionSummary(params: {
  memory: MemoryService;
  session: AppSessionRecord;
}): Promise<{ relativePath: string; markdown: string }> {
  return writeLiveSessionSummary({
    memory: params.memory,
    sessionId: params.session.sessionId,
    transcript: params.session.transcript,
    lastIntent: params.session.lastIntent,
    updatedAt: params.session.updatedAt,
  });
}

export function buildArchiveSlug(session: AppSessionRecord): string {
  const candidate = session.transcript
    .find((entry) => entry.role === "user" && entry.content.trim())
    ?.content.toLowerCase();
  const topic = candidate ? deriveTopic(candidate) : "session";
  return `${safeSessionId(session.sessionId)}-${topic}`;
}

function deriveTopic(text: string): string {
  const token = text
    .replace(/[^a-z0-9.\s_-]+/gi, " ")
    .split(/\s+/)
    .map((item) => item.trim())
    .find((item) => item.length >= 3 && !COMMON_WORDS.has(item));
  return token ? token.slice(0, 20) : "session";
}

function safeSessionId(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 32) || "session";
}

function extractMatchingLines(text: string, pattern: RegExp): string[] {
  return text
    .split(/[。\n;；]/)
    .map((line) => line.trim().replace(/^[-*]\s*/, ""))
    .filter((line) => line && pattern.test(line));
}

function extractConclusionLines(text: string): string[] {
  return text
    .split(/\n/)
    .map((line) => line.trim().replace(/^[-*]\s*/, ""))
    .filter((line) => line && /conclusion|总结|结论|practical conclusion|actionable/i.test(line));
}

function renderBullets(values: string[], fallback: string): string[] {
  return values.length > 0 ? values.map((value) => `- ${value}`) : [`- ${fallback}`];
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

const COMMON_WORDS = new Set([
  "please",
  "with",
  "from",
  "that",
  "this",
  "have",
  "hold",
  "give",
  "briefly",
  "analysis",
  "analyze",
  "using",
  "available",
  "skills",
  "configured",
  "source",
  "market",
  "data",
  "current",
  "currently",
]);
