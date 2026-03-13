import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export interface TelegramPairingPending {
  userId: string;
  chatId: string;
  username: string | null;
  code: string;
  createdAt: string;
  lastSeenAt: string;
}

export interface TelegramPairingApproved {
  userId: string;
  chatId: string;
  username: string | null;
  pairedAt: string;
  approvedBy: string;
}

interface TelegramPairingState {
  version: 1;
  pending: TelegramPairingPending[];
  approved: TelegramPairingApproved[];
}

const DEFAULT_STATE: TelegramPairingState = {
  version: 1,
  pending: [],
  approved: [],
};

export class TelegramPairingStore {
  constructor(private readonly filePath: string = "data/telegram-pairing.json") {}

  async isApproved(userId: string): Promise<boolean> {
    const state = await this.read();
    return state.approved.some((entry) => entry.userId === userId);
  }

  async listPending(): Promise<TelegramPairingPending[]> {
    const state = await this.read();
    return state.pending.slice().sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async upsertPending(params: {
    userId: string;
    chatId: string;
    username: string | null;
  }): Promise<{ code: string; created: boolean }> {
    const state = await this.read();
    const existing = state.pending.find((entry) => entry.userId === params.userId);
    const now = new Date().toISOString();
    if (existing) {
      existing.lastSeenAt = now;
      existing.chatId = params.chatId;
      existing.username = params.username;
      await this.write(state);
      return { code: existing.code, created: false };
    }
    const code = buildPairingCode();
    state.pending.push({
      userId: params.userId,
      chatId: params.chatId,
      username: params.username,
      code,
      createdAt: now,
      lastSeenAt: now,
    });
    await this.write(state);
    return { code, created: true };
  }

  async approveByCode(params: {
    code: string;
    approvedBy: string;
  }): Promise<TelegramPairingApproved | null> {
    const state = await this.read();
    const normalized = params.code.trim().toUpperCase();
    const index = state.pending.findIndex((entry) => entry.code === normalized);
    if (index < 0) {
      return null;
    }
    const [pending] = state.pending.splice(index, 1);
    if (!pending) {
      return null;
    }
    const approved: TelegramPairingApproved = {
      userId: pending.userId,
      chatId: pending.chatId,
      username: pending.username,
      pairedAt: new Date().toISOString(),
      approvedBy: params.approvedBy,
    };
    state.approved = state.approved.filter((entry) => entry.userId !== approved.userId);
    state.approved.push(approved);
    await this.write(state);
    return approved;
  }

  private async read(): Promise<TelegramPairingState> {
    try {
      const raw = await readFile(path.resolve(this.filePath), "utf8");
      const parsed = JSON.parse(raw) as TelegramPairingState;
      return {
        version: 1,
        pending: Array.isArray(parsed.pending) ? parsed.pending : [],
        approved: Array.isArray(parsed.approved) ? parsed.approved : [],
      };
    } catch {
      return structuredClone(DEFAULT_STATE);
    }
  }

  private async write(state: TelegramPairingState): Promise<void> {
    const filePath = path.resolve(this.filePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(state, null, 2) + "\n", "utf8");
  }
}

function buildPairingCode(): string {
  return randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
}
