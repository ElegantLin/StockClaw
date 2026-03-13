import type { RestartSentinelEntry, RestartSentinelPayload, RestartSentinelQueue } from "../restart/types.js";
import { JsonFileStore } from "./json-file-store.js";

export class RestartSentinelStore extends JsonFileStore<RestartSentinelQueue> {
  constructor(filePath: string = "data/restart-sentinel.json") {
    super(filePath);
  }

  async append(entry: RestartSentinelEntry): Promise<void> {
    await this.updateState((queue) => {
      queue.pending.push(entry);
    });
  }

  async read(): Promise<RestartSentinelQueue> {
    return this.snapshot((state) => state);
  }

  async consumeAll(): Promise<RestartSentinelEntry[]> {
    const queue = await this.read();
    if (!queue.pending.length) {
      return [];
    }
    await this.overwriteState(this.defaultState());
    return queue.pending;
  }

  protected defaultState(): RestartSentinelQueue {
    return {
      version: 1,
      pending: [],
    };
  }

  protected normalizeState(raw: unknown): RestartSentinelQueue {
    if (!raw || typeof raw !== "object") {
      return this.defaultState();
    }
    const parsed = raw as Partial<RestartSentinelQueue> & {
      pending?: unknown;
    };
    if (parsed.version !== 1 || !Array.isArray(parsed.pending)) {
      return this.defaultState();
    }
    return {
      version: 1,
      pending: parsed.pending
        .map((entry) => normalizeEntry(entry))
        .filter((entry): entry is RestartSentinelEntry => entry !== null),
    };
  }
}

function normalizeEntry(value: unknown): RestartSentinelEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const parsed = value as Partial<RestartSentinelEntry> & {
    payload?: Partial<RestartSentinelPayload>;
  };
  if (typeof parsed.id !== "string" || !parsed.id.trim() || !parsed.payload) {
    return null;
  }
  const payload = parsed.payload;
  if (
    typeof payload.sessionId !== "string" ||
    (payload.channel !== "web" && payload.channel !== "telegram") ||
    typeof payload.note !== "string" ||
    typeof payload.requestedAt !== "string"
  ) {
    return null;
  }
  return {
    id: parsed.id.trim(),
    payload: {
      sessionId: payload.sessionId,
      channel: payload.channel,
      note: payload.note,
      reason: typeof payload.reason === "string" ? payload.reason : null,
      requestedAt: payload.requestedAt,
    },
  };
}
