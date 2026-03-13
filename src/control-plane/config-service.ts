import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ConfigSnapshot } from "../types.js";
import { loadLlmConfig, resolveLlmConfigPath } from "../config/llm.js";
import { loadMcpServers, resolveMcpConfigPath } from "../config/mcp.js";

export class ConfigService {
  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly afterChange?: (target: "llm" | "mcp") => Promise<void>,
  ) {}

  async resolveMcpPath(): Promise<string> {
    return resolveMcpConfigPath(this.env);
  }

  async resolveLlmPath(): Promise<string | null> {
    return resolveLlmConfigPath();
  }

  async getRawConfig(target: "llm" | "mcp"): Promise<{ path: string | null; raw: string | null }> {
    if (target === "mcp") {
      const configPath = await this.resolveMcpPath();
      return {
        path: configPath,
        raw: await this.readRequired(configPath),
      };
    }
    const configPath = await this.resolveLlmPath();
    return {
      path: configPath,
      raw: await this.readOptional(configPath),
    };
  }

  async getSnapshot(target: "llm" | "mcp" | "all" = "all"): Promise<ConfigSnapshot> {
    const mcpPath = target === "llm" ? null : await this.resolveMcpPath();
    const llmPath = await this.resolveLlmPath();
    const [llm, mcp] = await Promise.all([
      target === "mcp" ? Promise.resolve(null) : this.readOptional(llmPath),
      target === "llm" || !mcpPath ? Promise.resolve(null) : this.readRequired(mcpPath),
    ]);
    const llmSnapshot: ConfigSnapshot["llm"] =
      target === "mcp"
        ? undefined
        : {
            path: llmPath,
            raw: redactConfigRaw("llm", llm),
          };
    const mcpSnapshot: ConfigSnapshot["mcp"] =
      target === "llm"
        ? undefined
        : {
            path: mcpPath || "",
            raw: redactConfigRaw("mcp", mcp ?? "") ?? "",
          };
    return {
      target,
      llm: llmSnapshot,
      mcp: mcpSnapshot,
    };
  }

  async patchConfig(target: "llm" | "mcp", patchText: string): Promise<ConfigSnapshot> {
    if (target === "mcp") {
      const destination = await this.resolveMcpPath();
      const current = JSON.parse((await this.getRawConfig("mcp")).raw || "{}") as Record<string, unknown>;
      const patch = JSON.parse(patchText) as Record<string, unknown>;
      const next = deepMerge(current, patch);
      await this.writeRaw(destination, JSON.stringify(next, null, 2) + "\n");
      await loadMcpServers({ ...this.env, STOCK_CLAW_MCP_CONFIG_PATH: destination });
      triggerReload(this.afterChange, "mcp");
      return this.getSnapshot("mcp");
    }

    const destination = await this.resolveLlmPath();
    if (!destination) {
      throw new Error("LLM patching requires a local LLM config file.");
    }
    if (!destination.endsWith(".json")) {
      throw new Error("LLM patching currently supports JSON config files only. Use config_apply for TOML.");
    }
    const current = JSON.parse((await this.getRawConfig("llm")).raw || "{}") as Record<string, unknown>;
    const patch = JSON.parse(patchText) as Record<string, unknown>;
    const next = deepMerge(current, patch);
    await this.writeRaw(destination, JSON.stringify(next, null, 2) + "\n");
    await loadLlmConfig(this.env);
    triggerReload(this.afterChange, "llm");
    return this.getSnapshot("llm");
  }

  async applyConfig(target: "llm" | "mcp", raw: string): Promise<ConfigSnapshot> {
    const destination = target === "mcp" ? await this.resolveMcpPath() : await this.resolveLlmPath();
    if (!destination) {
      throw new Error("LLM apply requires a local LLM config file.");
    }
    await this.writeRaw(destination, raw.trimEnd() + "\n");
    if (target === "mcp") {
      await loadMcpServers({ ...this.env, STOCK_CLAW_MCP_CONFIG_PATH: destination });
      triggerReload(this.afterChange, "mcp");
      return this.getSnapshot("mcp");
    }
    await loadLlmConfig(this.env);
    triggerReload(this.afterChange, "llm");
    return this.getSnapshot("llm");
  }

  private async writeRaw(filePath: string, content: string): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf8");
  }

  private async readRequired(filePath: string): Promise<string> {
    return readFile(filePath, "utf8");
  }

  private async readOptional(filePath: string | null): Promise<string | null> {
    if (!filePath) {
      return null;
    }
    try {
      return await readFile(filePath, "utf8");
    } catch {
      return null;
    }
  }
}

function deepMerge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const existing = next[key];
    if (isObject(existing) && isObject(value)) {
      next[key] = deepMerge(existing, value);
    } else {
      next[key] = value;
    }
  }
  return next;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function redactConfigRaw(target: "llm" | "mcp", raw: string | null): string | null {
  if (!raw) {
    return raw;
  }
  if (looksLikeJson(raw)) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return JSON.stringify(redactValue(parsed, target), null, 2);
    } catch {
      return redactText(raw);
    }
  }
  return redactText(raw);
}

function looksLikeJson(raw: string): boolean {
  const trimmed = raw.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function redactValue(value: unknown, target: "llm" | "mcp"): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, target));
  }
  if (!isObject(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => {
      if (shouldRedactKey(key, target) && typeof entryValue === "string" && entryValue.trim()) {
        return [key, "[REDACTED]"];
      }
      return [key, redactValue(entryValue, target)];
    }),
  );
}

function shouldRedactKey(key: string, target: "llm" | "mcp"): boolean {
  const normalized = key.toLowerCase();
  if (
    normalized === "apikey" ||
    normalized === "api_key" ||
    normalized === "authorization" ||
    normalized === "x-smithery-key" ||
    normalized === "x-api-key"
  ) {
    return true;
  }
  if (target === "mcp" && normalized.includes("secret")) {
    return true;
  }
  if (target === "mcp" && normalized.includes("token")) {
    return true;
  }
  return false;
}

function redactText(raw: string): string {
  return raw
    .replace(/(apiKey|api_key|LONGPORT_ACCESS_TOKEN|LONGPORT_APP_SECRET)\s*[:=]\s*"[^"]*"/gi, '$1 = "[REDACTED]"')
    .replace(/(authorization|x-smithery-key|x-api-key)\s*[:=]\s*"[^"]*"/gi, '$1 = "[REDACTED]"');
}

function triggerReload(
  handler: ((target: "llm" | "mcp") => Promise<void>) | undefined,
  target: "llm" | "mcp",
): void {
  if (!handler) {
    return;
  }
  void handler(target).catch((error) => {
    console.warn(`stock-claw config reload failed (${target}): ${String(error)}`);
  });
}
