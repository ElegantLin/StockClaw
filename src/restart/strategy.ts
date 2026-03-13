import { spawn, spawnSync } from "node:child_process";

import type { RestartAttempt } from "./types.js";

const SPAWN_TIMEOUT_MS = 2_000;

function formatSpawnFailure(result: {
  error?: unknown;
  status?: number | null;
  stdout?: string | Buffer | null;
  stderr?: string | Buffer | null;
}): string {
  if (result.error instanceof Error) {
    return result.error.message;
  }
  const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
  if (stderr) {
    return stderr;
  }
  const stdout = typeof result.stdout === "string" ? result.stdout.trim() : "";
  if (stdout) {
    return stdout;
  }
  if (typeof result.status === "number") {
    return `exit ${result.status}`;
  }
  return "unknown restart failure";
}

function normalizeSystemdUnit(raw?: string): string {
  const unit = raw?.trim() || "stock-claw.service";
  return unit.endsWith(".service") ? unit : `${unit}.service`;
}

function triggerLaunchctlRestart(env: NodeJS.ProcessEnv): RestartAttempt {
  const label = env.STOCK_CLAW_LAUNCHD_LABEL?.trim();
  if (!label) {
    return { ok: false, mode: "launchctl", detail: "missing STOCK_CLAW_LAUNCHD_LABEL" };
  }
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  const target = uid !== undefined ? `gui/${uid}/${label}` : label;
  const args = ["kickstart", "-k", target];
  const result = spawnSync("launchctl", args, {
    encoding: "utf8",
    timeout: SPAWN_TIMEOUT_MS,
  });
  return result.error || result.status !== 0
    ? {
        ok: false,
        mode: "launchctl",
        detail: formatSpawnFailure(result),
        tried: [`launchctl ${args.join(" ")}`],
      }
    : {
        ok: true,
        mode: "launchctl",
        tried: [`launchctl ${args.join(" ")}`],
      };
}

function triggerSystemdRestart(env: NodeJS.ProcessEnv): RestartAttempt {
  const unit = normalizeSystemdUnit(env.STOCK_CLAW_SYSTEMD_UNIT);
  const userArgs = ["--user", "restart", unit];
  const userResult = spawnSync("systemctl", userArgs, {
    encoding: "utf8",
    timeout: SPAWN_TIMEOUT_MS,
  });
  if (!userResult.error && userResult.status === 0) {
    return { ok: true, mode: "systemd", tried: [`systemctl ${userArgs.join(" ")}`] };
  }
  const systemArgs = ["restart", unit];
  const systemResult = spawnSync("systemctl", systemArgs, {
    encoding: "utf8",
    timeout: SPAWN_TIMEOUT_MS,
  });
  return !systemResult.error && systemResult.status === 0
    ? {
        ok: true,
        mode: "systemd",
        tried: [`systemctl ${userArgs.join(" ")}`, `systemctl ${systemArgs.join(" ")}`],
      }
    : {
        ok: false,
        mode: "systemd",
        detail: [
          `user: ${formatSpawnFailure(userResult)}`,
          `system: ${formatSpawnFailure(systemResult)}`,
        ].join("; "),
        tried: [`systemctl ${userArgs.join(" ")}`, `systemctl ${systemArgs.join(" ")}`],
      };
}

function triggerRespawn(): RestartAttempt {
  try {
    const lifecycle = process.env.npm_lifecycle_event?.trim();
    const npmExecPath = process.env.npm_execpath?.trim();
    const command =
      npmExecPath && lifecycle
        ? {
            file: process.execPath,
            args: [npmExecPath, "run", lifecycle],
            tried: `${process.execPath} ${npmExecPath} run ${lifecycle}`,
          }
        : {
            file: process.execPath,
            args: [...process.execArgv, ...process.argv.slice(1)],
            tried: `${process.execPath} ${[...process.execArgv, ...process.argv.slice(1)].join(" ")}`.trim(),
          };
    const child = spawn(command.file, command.args, {
      cwd: process.cwd(),
      env: process.env,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    return {
      ok: true,
      mode: "respawn",
      detail: child.pid ? `pid=${child.pid}` : undefined,
      tried: [command.tried],
    };
  } catch (error) {
    return {
      ok: false,
      mode: "respawn",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export function triggerApplicationRestart(env: NodeJS.ProcessEnv = process.env): RestartAttempt {
  if (process.platform === "darwin" && env.STOCK_CLAW_LAUNCHD_LABEL?.trim()) {
    return triggerLaunchctlRestart(env);
  }
  if (process.platform === "linux" && env.STOCK_CLAW_SYSTEMD_UNIT?.trim()) {
    return triggerSystemdRestart(env);
  }
  return triggerRespawn();
}
