import { JsonFileStore } from "./json-file-store.js";

interface TelegramRuntimeState {
  version: 1;
  lastUpdateId: number;
}

const DEFAULT_STATE: TelegramRuntimeState = {
  version: 1,
  lastUpdateId: 0,
};

export class TelegramStateStore extends JsonFileStore<TelegramRuntimeState> {
  constructor(filePath: string = "data/telegram-state.json") {
    super(filePath);
  }

  async readLastUpdateId(): Promise<number> {
    return this.snapshot((state) =>
      Number.isFinite(state.lastUpdateId) ? Math.max(0, Math.floor(state.lastUpdateId)) : 0,
    );
  }

  async writeLastUpdateId(lastUpdateId: number): Promise<void> {
    await this.overwriteState({
      version: 1,
      lastUpdateId: Math.max(0, Math.floor(lastUpdateId)),
    });
  }

  protected defaultState(): TelegramRuntimeState {
    return structuredClone(DEFAULT_STATE);
  }

  protected normalizeState(raw: unknown): TelegramRuntimeState {
    const parsed = raw && typeof raw === "object" ? (raw as Partial<TelegramRuntimeState>) : {};
    return {
      version: 1,
      lastUpdateId:
        typeof parsed.lastUpdateId === "number" && Number.isFinite(parsed.lastUpdateId)
          ? parsed.lastUpdateId
          : 0,
    };
  }
}
