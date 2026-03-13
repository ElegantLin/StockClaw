import path from "node:path";
import { randomUUID } from "node:crypto";

import type { RestartSentinelEntry, RestartSentinelPayload, RestartSentinelQueue } from "./types.js";
import { RestartSentinelStore } from "../state/restart-sentinel-store.js";

export function resolveRestartSentinelPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(env.STOCK_CLAW_RESTART_SENTINEL_PATH || "data/restart-sentinel.json");
}

export async function writeRestartSentinel(
  payload: RestartSentinelPayload,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ filePath: string; id: string }> {
  const filePath = resolveRestartSentinelPath(env);
  const entry: RestartSentinelEntry = {
    id: randomUUID(),
    payload,
  };
  await new RestartSentinelStore(filePath).append(entry);
  return { filePath, id: entry.id };
}

export async function readRestartSentinel(
  env: NodeJS.ProcessEnv = process.env,
): Promise<RestartSentinelQueue> {
  return new RestartSentinelStore(resolveRestartSentinelPath(env)).read();
}

export async function consumeRestartSentinels(
  env: NodeJS.ProcessEnv = process.env,
): Promise<RestartSentinelEntry[]> {
  return new RestartSentinelStore(resolveRestartSentinelPath(env)).consumeAll();
}

export function formatRestartSentinelMessage(payload: RestartSentinelPayload): string {
  const reason = payload.reason?.trim();
  return reason
    ? `${payload.note}\nReason: ${reason}`
    : payload.note;
}
