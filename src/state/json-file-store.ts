import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export abstract class JsonFileStore<TState> {
  private static readonly queues = new Map<string, Promise<void>>();

  constructor(private readonly filePath: string) {}

  get path(): string {
    return path.resolve(this.filePath);
  }

  protected async readState(): Promise<TState> {
    try {
      const raw = await readFile(this.path, "utf8");
      return this.normalizeState(JSON.parse(raw));
    } catch {
      return this.defaultState();
    }
  }

  protected async updateState<TResult>(
    mutator: (state: TState) => Promise<TResult> | TResult,
  ): Promise<TResult> {
    return this.enqueue(async () => {
      const state = await this.readState();
      const result = await mutator(state);
      await this.writeState(state);
      return result;
    });
  }

  protected async overwriteState(state: TState): Promise<void> {
    await this.enqueue(async () => {
      await this.writeState(state);
    });
  }

  protected async snapshot<R>(reader: (state: TState) => Promise<R> | R): Promise<R> {
    const state = await this.readState();
    return reader(state);
  }

  protected abstract defaultState(): TState;

  protected abstract normalizeState(raw: unknown): TState;

  private async enqueue<TResult>(work: () => Promise<TResult>): Promise<TResult> {
    const key = this.path;
    const previous = JsonFileStore.queues.get(key) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    JsonFileStore.queues.set(key, next);
    await previous;
    try {
      return await work();
    } finally {
      release();
      if (JsonFileStore.queues.get(key) === next) {
        JsonFileStore.queues.delete(key);
      }
    }
  }

  private async writeState(state: TState): Promise<void> {
    await mkdir(path.dirname(this.path), { recursive: true });
    const tempPath = `${this.path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    try {
      await rename(tempPath, this.path);
    } catch {
      await rm(this.path, { force: true }).catch(() => {});
      await rename(tempPath, this.path);
    }
  }
}
