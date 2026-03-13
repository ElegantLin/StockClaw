import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

interface BacktestWorkerLockFile {
  pid: number;
  ownerId: string;
  acquiredAt: string;
}

export class BacktestWorkerLock {
  constructor(private readonly filePath: string = "data/backtest-worker.lock.json") {}

  async acquire(ownerId: string): Promise<{ acquired: boolean; holderPid: number | null; holderOwnerId: string | null }> {
    const current = process.pid;
    const existing = await this.read();
    if (existing && existing.ownerId === ownerId && existing.pid === current) {
      return { acquired: true, holderPid: current, holderOwnerId: ownerId };
    }
    if (existing && existing.ownerId !== ownerId && isProcessAlive(existing.pid)) {
      return { acquired: false, holderPid: existing.pid, holderOwnerId: existing.ownerId };
    }
    const absolute = path.resolve(this.filePath);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(
      absolute,
      JSON.stringify(
        { pid: current, ownerId, acquiredAt: new Date().toISOString() } satisfies BacktestWorkerLockFile,
        null,
        2,
      ) + "\n",
      "utf8",
    );
    return { acquired: true, holderPid: existing?.pid ?? null, holderOwnerId: existing?.ownerId ?? null };
  }

  async release(ownerId: string): Promise<void> {
    const existing = await this.read();
    if (!existing || existing.pid !== process.pid || existing.ownerId !== ownerId) {
      return;
    }
    await rm(path.resolve(this.filePath), { force: true });
  }

  private async read(): Promise<BacktestWorkerLockFile | null> {
    try {
      const raw = await readFile(path.resolve(this.filePath), "utf8");
      const parsed = JSON.parse(raw) as Partial<BacktestWorkerLockFile>;
      if (typeof parsed.pid !== "number") {
        return null;
      }
      return {
        pid: parsed.pid,
        ownerId: typeof parsed.ownerId === "string" && parsed.ownerId.trim() ? parsed.ownerId : "",
        acquiredAt: typeof parsed.acquiredAt === "string" ? parsed.acquiredAt : new Date(0).toISOString(),
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
