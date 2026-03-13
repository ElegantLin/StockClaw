import type { SpecialistResult } from "../types.js";
import { JsonFileStore } from "./json-file-store.js";

export interface SpawnedSessionRecord extends SpecialistResult {
  rootSessionId: string;
  requestId: string;
}

interface SpawnStoreFile {
  sessions: SpawnedSessionRecord[];
}

export class SpawnStore extends JsonFileStore<SpawnStoreFile> {
  constructor(filePath: string = "data/spawn-history.json") {
    super(filePath);
  }

  async append(record: SpawnedSessionRecord): Promise<void> {
    await this.updateState((current) => {
      current.sessions.push(record);
    });
  }

  async listByRequest(rootSessionId: string, requestId: string): Promise<SpawnedSessionRecord[]> {
    return this.snapshot((current) =>
      current.sessions.filter((item) => item.rootSessionId === rootSessionId && item.requestId === requestId),
    );
  }

  async listByRootSession(rootSessionId: string): Promise<SpawnedSessionRecord[]> {
    return this.snapshot((current) => current.sessions.filter((item) => item.rootSessionId === rootSessionId));
  }

  async clearRootSession(rootSessionId: string): Promise<void> {
    await this.updateState((current) => {
      current.sessions = current.sessions.filter((item) => item.rootSessionId !== rootSessionId);
    });
  }

  protected defaultState(): SpawnStoreFile {
    return { sessions: [] };
  }

  protected normalizeState(raw: unknown): SpawnStoreFile {
    const parsed = raw && typeof raw === "object" ? (raw as Partial<SpawnStoreFile>) : {};
    return {
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
    };
  }
}
