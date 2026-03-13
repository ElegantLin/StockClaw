import type { RestartRequestResult, RestartSentinelPayload } from "./types.js";
import { writeRestartSentinel } from "./sentinel.js";

type RestartExecutor = (payload: RestartSentinelPayload) => Promise<void>;

export class RestartController {
  private executor: RestartExecutor | null = null;

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  setExecutor(executor: RestartExecutor): void {
    this.executor = executor;
  }

  async requestRestart(params: {
    sessionId: string;
    channel: "web" | "telegram";
    note: string;
    reason?: string;
  }): Promise<RestartRequestResult> {
    const payload: RestartSentinelPayload = {
      sessionId: params.sessionId,
      channel: params.channel,
      note: params.note.trim(),
      reason: params.reason?.trim() || null,
      requestedAt: new Date().toISOString(),
    };
    const sentinel = await writeRestartSentinel(payload, this.env);
    if (this.executor) {
      setTimeout(() => {
        void this.executor?.(payload).catch((error) => {
          console.error(`stock-claw restart failed: ${String(error)}`);
        });
      }, 250);
    }
    return {
      ok: true,
      action: "restart_runtime",
      message: "stock-claw restart scheduled.",
      details: {
        id: sentinel.id,
        sessionId: payload.sessionId,
        channel: payload.channel,
        reason: payload.reason,
        note: payload.note,
        requestedAt: payload.requestedAt,
      },
    };
  }
}
