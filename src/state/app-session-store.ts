import type { AppSessionRecord, ChannelType, IntentType, UsageAggregate, UsageSnapshot, UserResponsePayload } from "../types.js";
import { JsonFileStore } from "./json-file-store.js";

type SessionStoreState = Record<string, AppSessionRecord>;

export class AppSessionStore extends JsonFileStore<SessionStoreState> {
  constructor(filePath: string = "data/app-sessions.json") {
    super(filePath);
  }

  async createOrLoad(params: {
    sessionId: string;
    userId: string;
    channel: ChannelType;
    now?: string;
  }): Promise<AppSessionRecord> {
    return this.updateState((store) => {
      const existing = store[params.sessionId];
      if (existing) {
        return existing;
      }
      const now = params.now ?? new Date().toISOString();
      const record: AppSessionRecord = {
        sessionId: params.sessionId,
        userId: params.userId,
        channel: params.channel,
        createdAt: now,
        updatedAt: now,
        lastIntent: null,
        transcript: [],
        lastResult: null,
        sessionSummary: null,
        sessionSummaryUpdatedAt: null,
        lastUsage: null,
        cumulativeUsage: emptyUsageAggregate(),
        dailyUsage: emptyUsageAggregate(),
        dailyUsageDate: null,
      };
      store[params.sessionId] = record;
      return record;
    });
  }

  async get(sessionId: string): Promise<AppSessionRecord | null> {
    return this.snapshot((store) => store[sessionId] ?? null);
  }

  async appendUserMessage(params: {
    sessionId: string;
    content: string;
    timestamp?: string;
  }): Promise<AppSessionRecord> {
    return this.updateState((store) => {
      const record = this.requireSession(store, params.sessionId);
      const ts = params.timestamp ?? new Date().toISOString();
      record.transcript.push({
        role: "user",
        content: params.content,
        timestamp: ts,
      });
      record.updatedAt = ts;
      return record;
    });
  }

  async appendAssistantResult(params: {
    sessionId: string;
    intent: IntentType;
    response: UserResponsePayload;
    usage?: UsageAggregate;
    timestamp?: string;
  }): Promise<AppSessionRecord> {
    return this.updateState((store) => {
      const record = this.requireSession(store, params.sessionId);
      const ts = params.timestamp ?? new Date().toISOString();
      record.lastIntent = params.intent;
      record.lastResult = params.response;
      if (params.usage) {
        record.lastUsage = snapshotFromAggregate(params.usage);
        record.cumulativeUsage = mergeUsage(record.cumulativeUsage, params.usage);
        const usageDate = toShanghaiDateKey(ts);
        const nextDailyUsage = record.dailyUsageDate === usageDate ? record.dailyUsage : emptyUsageAggregate();
        record.dailyUsage = mergeUsage(nextDailyUsage, params.usage);
        record.dailyUsageDate = usageDate;
      }
      record.updatedAt = ts;
      record.transcript.push({
        role: "assistant",
        content: params.response.message,
        timestamp: ts,
      });
      return record;
    });
  }

  async reset(sessionId: string, timestamp?: string): Promise<AppSessionRecord | null> {
    return this.updateState((store) => {
      const existing = store[sessionId];
      if (!existing) {
        return null;
      }
      const ts = timestamp ?? new Date().toISOString();
      const next: AppSessionRecord = {
        ...existing,
        updatedAt: ts,
        lastIntent: null,
        lastResult: null,
        transcript: [],
        sessionSummary: null,
        sessionSummaryUpdatedAt: null,
        lastUsage: null,
      };
      store[sessionId] = next;
      return next;
    });
  }

  async updateSummary(params: {
    sessionId: string;
    summary: string;
    timestamp?: string;
  }): Promise<AppSessionRecord> {
    return this.updateState((store) => {
      const record = this.requireSession(store, params.sessionId);
      const ts = params.timestamp ?? new Date().toISOString();
      record.sessionSummary = params.summary;
      record.sessionSummaryUpdatedAt = ts;
      record.updatedAt = ts;
      return record;
    });
  }

  protected defaultState(): SessionStoreState {
    return {};
  }

  protected normalizeState(raw: unknown): SessionStoreState {
    const parsed = raw && typeof raw === "object" ? (raw as Record<string, Partial<AppSessionRecord>>) : {};
    return Object.fromEntries(
      Object.entries(parsed ?? {}).map(([sessionId, record]) => [sessionId, normalizeRecord(sessionId, record)]),
    );
  }

  private requireSession(store: SessionStoreState, sessionId: string): AppSessionRecord {
    const record = store[sessionId];
    if (!record) {
      throw new Error(`Unknown app session '${sessionId}'.`);
    }
    return record;
  }
}

function normalizeRecord(sessionId: string, record: Partial<AppSessionRecord>): AppSessionRecord {
  const createdAt = typeof record.createdAt === "string" ? record.createdAt : new Date().toISOString();
  const updatedAt = typeof record.updatedAt === "string" ? record.updatedAt : createdAt;
  return {
    sessionId: typeof record.sessionId === "string" ? record.sessionId : sessionId,
    userId: typeof record.userId === "string" ? record.userId : "unknown",
    channel: record.channel === "telegram" ? "telegram" : "web",
    createdAt,
    updatedAt,
    lastIntent: record.lastIntent ?? null,
    transcript: Array.isArray(record.transcript) ? record.transcript : [],
    lastResult: record.lastResult ?? null,
    sessionSummary: record.sessionSummary ?? null,
    sessionSummaryUpdatedAt: record.sessionSummaryUpdatedAt ?? null,
    lastUsage: normalizeUsageSnapshot(record.lastUsage),
    cumulativeUsage: normalizeUsageAggregate(record.cumulativeUsage),
    dailyUsage: normalizeUsageAggregate(record.dailyUsage),
    dailyUsageDate: typeof record.dailyUsageDate === "string" ? record.dailyUsageDate : null,
  };
}

function normalizeUsageSnapshot(value: unknown): UsageSnapshot | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const cost = (raw.cost && typeof raw.cost === "object" ? raw.cost : {}) as Record<string, unknown>;
  return {
    input: numeric(raw.input),
    output: numeric(raw.output),
    cacheRead: numeric(raw.cacheRead),
    cacheWrite: numeric(raw.cacheWrite),
    totalTokens: numeric(raw.totalTokens),
    contextTokens: numeric(raw.contextTokens),
    cost: {
      input: numeric(cost.input),
      output: numeric(cost.output),
      cacheRead: numeric(cost.cacheRead),
      cacheWrite: numeric(cost.cacheWrite),
      total: numeric(cost.total),
    },
  };
}

function normalizeUsageAggregate(value: unknown): UsageAggregate {
  const snapshot = normalizeUsageSnapshot(value);
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    ...(snapshot ?? {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    }),
    turns: numeric(raw.turns),
    contextTokens: numeric(raw.contextTokens),
  };
}

function emptyUsageAggregate(): UsageAggregate {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    turns: 0,
    contextTokens: 0,
  };
}

function snapshotFromAggregate(value: UsageAggregate): UsageSnapshot {
  return {
    input: value.input,
    output: value.output,
    cacheRead: value.cacheRead,
    cacheWrite: value.cacheWrite,
    totalTokens: value.totalTokens,
    contextTokens: value.contextTokens,
    cost: { ...value.cost },
  };
}

function mergeUsage(current: UsageAggregate, next: UsageAggregate): UsageAggregate {
  return {
    input: current.input + next.input,
    output: current.output + next.output,
    cacheRead: current.cacheRead + next.cacheRead,
    cacheWrite: current.cacheWrite + next.cacheWrite,
    totalTokens: current.totalTokens + next.totalTokens,
    cost: {
      input: current.cost.input + next.cost.input,
      output: current.cost.output + next.cost.output,
      cacheRead: current.cost.cacheRead + next.cost.cacheRead,
      cacheWrite: current.cost.cacheWrite + next.cost.cacheWrite,
      total: current.cost.total + next.cost.total,
    },
    turns: current.turns + next.turns,
    contextTokens: next.contextTokens || current.contextTokens,
  };
}

function numeric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toShanghaiDateKey(timestamp: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(new Date(timestamp));
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}
