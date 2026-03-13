import { syncAppSessionSummary } from "../memory/session-summary.js";
import type { MemoryService } from "../memory/service.js";
import type { SessionService } from "../sessions/service.js";
import type { UserResponsePayload } from "../types.js";
import type { TelegramDeliveryGateway } from "../telegram/delivery.js";
import { buildBacktestJobResultMarkdown, buildBacktestJobResultMessage } from "./messages.js";
import type { BacktestJob } from "./types.js";

export class BacktestNotifier {
  constructor(
    private readonly sessions: SessionService,
    private readonly memory: MemoryService,
    private readonly telegram: TelegramDeliveryGateway,
  ) {}

  async appendJobResult(job: BacktestJob): Promise<string> {
    const timestamp = job.completedAt ?? new Date().toISOString();
    const response: UserResponsePayload = {
      requestId: `backtest-job:${job.jobId}`,
      sessionId: job.parentSessionId,
      message: buildBacktestJobResultMessage(job),
      blocks: [
        {
          type: "markdown",
          title: "backtest_job_result",
          content: buildBacktestJobResultMarkdown(job),
        },
      ],
      actions: [],
    };
    await this.sessions.createSession({
      sessionId: job.parentSessionId,
      userId: job.parentUserId,
      channel: job.parentChannel,
      now: timestamp,
    });
    const record = await this.sessions.appendAssistantResult({
      sessionId: job.parentSessionId,
      intent: "investment_research",
      response,
      timestamp,
    });
    const summary = await syncAppSessionSummary({
      memory: this.memory,
      session: record,
    });
    await this.sessions.updateSessionSummary({
      sessionId: record.sessionId,
      summary: summary.markdown,
      timestamp,
    });
    return timestamp;
  }

  async sendChannelNotice(job: BacktestJob): Promise<string> {
    if (job.parentChannel !== "telegram") {
      return job.completedAt ?? new Date().toISOString();
    }
    await this.telegram.sendSystemNotice(job.parentSessionId, buildBacktestJobResultMessage(job));
    return new Date().toISOString();
  }
}
