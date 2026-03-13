import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import type { OpsExecutionResult } from "../types.js";
import { ConfigService } from "./config-service.js";

export class OpsService {
  constructor(
    private readonly config: ConfigService,
    private readonly cwd: string = process.cwd(),
    private readonly afterSkillInstall?: () => Promise<void>,
  ) {}

  async installMcp(params: {
    name: string;
    command: string;
    args: string[];
    cwd?: string;
    env?: Record<string, string>;
  }): Promise<OpsExecutionResult> {
    const current = await this.config.getRawConfig("mcp");
    const raw = current.raw ? JSON.parse(current.raw) : { mcpServers: {} };
    const servers = ensureObject(raw.mcpServers);
    const previous = JSON.stringify(raw, null, 2);
    servers[params.name] = {
      type: "stdio",
      command: params.command,
      args: params.args,
      cwd: params.cwd,
      env: params.env ?? {},
    };
    raw.mcpServers = servers;
    try {
      await this.config.applyConfig("mcp", JSON.stringify(raw, null, 2));
      await this.verifyRuntime("mcp");
    } catch (error) {
      await this.config.applyConfig("mcp", previous);
      throw error;
    }
    return {
      ok: true,
      action: "install_mcp",
      message: `Installed MCP server '${params.name}' into MCP config.`,
      details: { name: params.name, verified: true },
    };
  }

  async installSkill(params: { source: string; name?: string }): Promise<OpsExecutionResult> {
    const skillsRoot = path.resolve(this.cwd, "skills");
    await mkdir(skillsRoot, { recursive: true });
    const resolvedName = params.name?.trim() || inferName(params.source);
    const target = path.join(skillsRoot, resolvedName);
    if (path.resolve(target).startsWith(path.resolve(skillsRoot)) === false) {
      throw new Error("Resolved skill target escaped the local skills directory.");
    }
    if (isRemoteSkillSource(params.source)) {
      await runCommand("git", ["clone", "--depth", "1", params.source, target], this.cwd);
    } else {
      await cp(path.resolve(params.source), target, { recursive: true });
    }
    triggerSkillReload(this.afterSkillInstall);
    return {
      ok: true,
      action: "install_skill",
      message: `Installed skill '${resolvedName}'.`,
      details: { target },
    };
  }

  async verifyRuntime(target: "llm" | "mcp" | "all" = "all"): Promise<OpsExecutionResult> {
    const snapshot = await this.config.getSnapshot(target);
    return {
      ok: true,
      action: "verify_runtime",
      message: `Verified ${target} configuration.`,
      details: snapshot as unknown as Record<string, unknown>,
    };
  }
}

function inferName(source: string): string {
  const normalized = source.replace(/[\\/]+$/, "");
  const base = normalized.split(/[\\/]/).pop();
  return base && base.trim() ? base.trim() : `skill-${Date.now()}`;
}

function isRemoteSkillSource(source: string): boolean {
  const normalized = source.trim();
  if (/^https?:\/\//i.test(normalized)) {
    return true;
  }
  if (/^git@/i.test(normalized)) {
    return true;
  }
  if (/^[\w.-]+:[\w./-]+$/i.test(normalized) && !/^[a-z]:\\/i.test(normalized)) {
    return true;
  }
  return false;
}

function ensureObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function runCommand(command: string, args: string[], cwd: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "ignore",
      shell: process.platform === "win32",
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with code ${code ?? "unknown"}.`));
    });
  });
}

function triggerSkillReload(handler: (() => Promise<void>) | undefined): void {
  if (!handler) {
    return;
  }
  void handler().catch((error) => {
    console.warn(`stock-claw skill reload failed: ${String(error)}`);
  });
}
