import type {
  AppSessionRecord,
  IntentType,
  UsageAggregate,
  UserRequest,
  UserResponsePayload,
} from "../types.js";
import { AppSessionStore } from "../state/app-session-store.js";

export class SessionService {
  constructor(private readonly store: AppSessionStore) {}

  createSession(params: {
    sessionId: string;
    userId: string;
    channel: AppSessionRecord["channel"];
    now?: string;
  }): Promise<AppSessionRecord> {
    return this.store.createOrLoad(params);
  }

  getSession(sessionId: string): Promise<AppSessionRecord | null> {
    return this.store.get(sessionId);
  }

  async ensureRequestSession(request: UserRequest): Promise<AppSessionRecord> {
    return this.store.createOrLoad({
      sessionId: request.sessionId,
      userId: request.userId,
      channel: request.channel,
      now: request.timestamp,
    });
  }

  async appendUserMessage(request: UserRequest): Promise<AppSessionRecord> {
    return this.store.appendUserMessage({
      sessionId: request.sessionId,
      content: request.message,
      timestamp: request.timestamp,
    });
  }

  async appendAssistantResult(params: {
    sessionId: string;
    intent: IntentType;
    response: UserResponsePayload;
    usage?: UsageAggregate;
    timestamp?: string;
  }): Promise<AppSessionRecord> {
    return this.store.appendAssistantResult(params);
  }

  async resetSession(sessionId: string, timestamp?: string): Promise<AppSessionRecord | null> {
    return this.store.reset(sessionId, timestamp);
  }

  async updateSessionSummary(params: {
    sessionId: string;
    summary: string;
    timestamp?: string;
  }): Promise<AppSessionRecord> {
    return this.store.updateSummary(params);
  }
}
