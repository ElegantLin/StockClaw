import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

interface TelegramPollerLockFile {
  pid: number;
  acquiredAt: string;
}

export class TelegramPollerLock {
  constructor(private readonly filePath: string = "data/telegram-poller.lock.json") {}

  async acquire(): Promise<{ acquired: boolean; holderPid: number | null }> {
    const current = process.pid;
    const existing = await this.read();
    if (existing && existing.pid !== current && isProcessAlive(existing.pid)) {
      return { acquired: false, holderPid: existing.pid };
    }
    const absolute = path.resolve(this.filePath);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(
      absolute,
      JSON.stringify({ pid: current, acquiredAt: new Date().toISOString() } satisfies TelegramPollerLockFile, null, 2) + "\n",
      "utf8",
    );
    return { acquired: true, holderPid: null };
  }

  async release(): Promise<void> {
    const existing = await this.read();
    if (!existing || existing.pid !== process.pid) {
      return;
    }
    await rm(path.resolve(this.filePath), { force: true });
  }

  private async read(): Promise<TelegramPollerLockFile | null> {
    try {
      const raw = await readFile(path.resolve(this.filePath), "utf8");
      const parsed = JSON.parse(raw) as Partial<TelegramPollerLockFile>;
      if (typeof parsed.pid !== "number") {
        return null;
      }
      return {
        pid: parsed.pid,
        acquiredAt:
          typeof parsed.acquiredAt === "string" ? parsed.acquiredAt : new Date(0).toISOString(),
      };
    } catch {
      return null;
    }
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
