import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

export class AuditLogger {
  constructor(private readonly filePath: string = "data/trade_log.jsonl") {}

  async append(record: Record<string, unknown>): Promise<void> {
    const target = path.resolve(this.filePath);
    await mkdir(path.dirname(target), { recursive: true });
    await appendFile(target, JSON.stringify(record) + "\n", "utf8");
  }
}
