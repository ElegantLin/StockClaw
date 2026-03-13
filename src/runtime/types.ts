import type { CronService } from "../cron/service.js";
import type { McpRuntime } from "../mcp/runtime.js";
import type { MemoryService } from "../memory/service.js";
import type { Orchestrator } from "../orchestrator.js";
import type { RuntimeEventLogger } from "../runtime-logging/logger.js";
import type { SkillRegistry } from "../skills/registry.js";
import type { TelegramDeliveryTarget } from "../telegram/delivery.js";

export interface RuntimeHooks {
  afterConfigChange?: (target: "llm" | "mcp") => Promise<void>;
  afterSkillInstall?: () => Promise<void>;
}

export interface ApplicationRuntime {
  orchestrator: Orchestrator;
  cron: CronService;
  mcpRuntime: McpRuntime;
  memory: MemoryService;
  skills: SkillRegistry;
  runtimeLogger: RuntimeEventLogger;
  attachTelegram(telegram: TelegramDeliveryTarget | null): void;
  close(): Promise<void>;
}
