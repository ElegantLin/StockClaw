export type RuntimeEventLevel = "info" | "warn" | "error";

export interface RuntimeEventRecord {
  timestamp: string;
  level: RuntimeEventLevel;
  component: string;
  type: string;
  sessionId?: string | null;
  requestId?: string | null;
  profileId?: string | null;
  data?: Record<string, unknown>;
}
