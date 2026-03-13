export type RestartMode = "launchctl" | "systemd" | "respawn";

export interface RestartSentinelPayload {
  sessionId: string;
  channel: "web" | "telegram";
  note: string;
  reason: string | null;
  requestedAt: string;
}

export interface RestartSentinelEntry {
  id: string;
  payload: RestartSentinelPayload;
}

export interface RestartSentinelQueue {
  version: 1;
  pending: RestartSentinelEntry[];
}

export interface RestartAttempt {
  ok: boolean;
  mode: RestartMode;
  detail?: string;
  tried?: string[];
}

export interface RestartRequestResult {
  ok: boolean;
  action: "restart_runtime";
  message: string;
  details: {
    id: string;
    sessionId: string;
    channel: "web" | "telegram";
    reason: string | null;
    note: string;
    requestedAt: string;
  };
}
