import { randomUUID } from "node:crypto";

import { AppSessionStore } from "../state/app-session-store.js";
import type { UserResponsePayload } from "../types.js";
import type { TelegramExtension } from "../telegram/service.js";
import { consumeRestartSentinels, formatRestartSentinelMessage } from "./sentinel.js";

export async function deliverRestartSentinelOnStartup(params: {
  env?: NodeJS.ProcessEnv;
  telegram: TelegramExtension | null;
  appSessionPath?: string;
}): Promise<void> {
  const env = params.env ?? process.env;
  const sentinels = await consumeRestartSentinels(env);
  if (!sentinels.length) {
    return;
  }
  const store = new AppSessionStore(params.appSessionPath || env.STOCK_CLAW_APP_SESSION_PATH || "data/app-sessions.json");
  for (const sentinel of sentinels) {
    const payload = sentinel.payload;
    const message = formatRestartSentinelMessage(payload);

    if (payload.channel === "telegram" && params.telegram) {
      await params.telegram.sendSystemNotice(payload.sessionId, message);
      continue;
    }

    const response: UserResponsePayload = {
      requestId: `restart:${randomUUID()}`,
      sessionId: payload.sessionId,
      message,
      blocks: [
        {
          type: "markdown",
          title: "restart_notice",
          content: message,
        },
      ],
      actions: [],
    };
    try {
      await store.appendAssistantResult({
        sessionId: payload.sessionId,
        intent: "ops_request",
        response,
      });
    } catch {
      // best effort
    }
  }
}
