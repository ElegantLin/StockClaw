import type { SessionService } from "../sessions/service.js";
import type { UserResponsePayload } from "../types.js";
import type { TelegramDeliveryTarget } from "../telegram/delivery.js";
import type { CronNotification } from "./types.js";

export class CronNotifier {
  private telegram: TelegramDeliveryTarget | null = null;

  constructor(private readonly sessions: SessionService) {}

  attachTelegram(telegram: TelegramDeliveryTarget | null): void {
    this.telegram = telegram;
  }

  async deliverNotice(notification: CronNotification): Promise<void> {
    const response: UserResponsePayload = {
      requestId: notification.requestId,
      sessionId: notification.sessionId,
      message: notification.message,
      blocks: notification.blocks ?? [],
      actions: [],
    };
    await this.sessions.createSession({
      sessionId: notification.sessionId,
      userId: notification.userId,
      channel: notification.channel,
      now: notification.timestamp,
    });
    await this.sessions.appendAssistantResult({
      sessionId: notification.sessionId,
      intent: notification.intent ?? "chat",
      response,
      timestamp: notification.timestamp,
    });
    if (notification.channel === "telegram" && this.telegram) {
      await this.telegram.sendSystemNotice(notification.sessionId, notification.message);
    }
  }

  async sendChannelNotice(notification: Omit<CronNotification, "blocks" | "intent">): Promise<void> {
    if (notification.channel === "telegram" && this.telegram) {
      await this.telegram.sendSystemNotice(notification.sessionId, notification.message);
    }
  }
}
