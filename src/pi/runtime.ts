import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  type ToolDefinition,
} from "@mariozechner/pi-coding-agent";

import type { LlmConfig } from "../config/llm.js";
import type { McpRuntime } from "../mcp/runtime.js";
import type { RuntimeEventLogger } from "../runtime-logging/logger.js";
import type { SkillRegistry } from "../skills/registry.js";
import type { AgentRunResult, ConversationMessage, ToolCallRecord, UsageAggregate } from "../types.js";

interface RunAgentParams {
  sessionKey: string;
  systemPrompt: string;
  userPrompt: string;
  allowedTools?: readonly string[];
  customTools?: ToolDefinition[];
  persistent?: boolean;
  beforeCompact?: (messages: ConversationMessage[]) => Promise<{
    customInstructions?: string | null;
  } | void>;
}

interface SessionIndex {
  [sessionKey: string]: string;
}

export class PiRuntime {
  private readonly providerName = "stock-claw-openai";
  private readonly sessionRoot: string;
  private readonly sessionIndexPath: string;
  private readonly authPath: string;
  private readonly modelsPath: string;
  private readonly agentDir: string;

  constructor(
    private readonly llm: LlmConfig,
    private readonly mcpRuntime: McpRuntime,
    private readonly skills: SkillRegistry,
    private readonly cwd: string = process.cwd(),
    private readonly runtimeLogger: RuntimeEventLogger | null = null,
  ) {
    this.sessionRoot = path.resolve("data/pi-sessions");
    this.sessionIndexPath = path.join(this.sessionRoot, "index.json");
    this.agentDir = path.resolve("data/pi-agent");
    this.authPath = path.join(this.agentDir, "auth.json");
    this.modelsPath = path.join(this.agentDir, "models.json");
  }

  async runPersistent(params: Omit<RunAgentParams, "persistent">): Promise<AgentRunResult> {
    return this.runAgent({ ...params, persistent: true });
  }

  async runEphemeral(params: Omit<RunAgentParams, "persistent">): Promise<AgentRunResult> {
    return this.runAgent({ ...params, persistent: false });
  }

  private async runAgent(params: RunAgentParams): Promise<AgentRunResult> {
    await mkdir(this.sessionRoot, { recursive: true });
    await mkdir(this.agentDir, { recursive: true });
    await this.runtimeLogger?.info({
      component: "agent",
      type: "agent_run_started",
      sessionId: params.sessionKey,
      data: {
        persistent: params.persistent ?? false,
        customToolCount: params.customTools?.length ?? 0,
      },
    });

    const systemPrompt = this.composeSystemPrompt(params.systemPrompt);
    const authStorage = AuthStorage.create(this.authPath);
    const modelRegistry = new ModelRegistry(authStorage, this.modelsPath);
    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: true, maxRetries: 2 },
    });
    const loader = new DefaultResourceLoader({
      cwd: this.cwd,
      agentDir: this.agentDir,
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      agentsFilesOverride: () => ({ agentsFiles: [] }),
      systemPromptOverride: () => systemPrompt,
      extensionFactories: [
        (pi) => {
          pi.registerProvider(this.providerName, {
            baseUrl: this.llm.endpoint.baseUrl,
            apiKey: this.llm.endpoint.apiKey,
            api: "openai-completions",
            headers: this.llm.endpoint.headers,
            models: [
              {
                id: this.llm.chat.model,
                name: this.llm.chat.model,
                reasoning: true,
                input: ["text"],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: this.llm.chat.contextWindow,
                maxTokens: this.llm.chat.maxOutputTokens,
                compat: {
                  supportsDeveloperRole: false,
                  maxTokensField: "max_tokens",
                },
              },
            ],
          });
        },
      ],
    });
    await loader.reload();

    const sessionManager = params.persistent
      ? await this.getPersistentSessionManager(params.sessionKey)
      : SessionManager.inMemory();
    const customTools = params.customTools ?? this.mcpRuntime.createPiCustomTools(params.allowedTools);
    const { session } = await createAgentSession({
      cwd: this.cwd,
      agentDir: this.agentDir,
      authStorage,
      modelRegistry,
      settingsManager,
      resourceLoader: loader,
      sessionManager,
      tools: [],
      customTools,
    });

    try {
      const model = modelRegistry.find(this.providerName, this.llm.chat.model);
      if (!model) {
        throw new Error(`Unable to resolve PI model ${this.providerName}/${this.llm.chat.model}.`);
      }
      await session.setModel(model);

      if (params.persistent && session.sessionFile) {
        await this.storeSessionFile(params.sessionKey, session.sessionFile);
      }

      const toolCalls: ToolCallRecord[] = [];
      const usage = emptyUsageAggregate();
      const unsubscribe = session.subscribe((event) => {
        if (event.type === "tool_execution_start") {
          toolCalls.push({
            toolName: event.toolName,
            args: normalizeArgs(event.args),
          });
          void this.runtimeLogger?.info({
            component: "agent",
            type: "tool_selected",
            sessionId: params.sessionKey,
            data: {
              toolName: event.toolName,
            },
          });
        }
        if (event.type === "message_end" && event.message && readMessageRole(event.message) === "assistant") {
          mergeUsageAggregate(usage, readUsage(event.message));
        }
      });

      let compacted = false;
      if (shouldCompact(session.messages, this.llm.chat.compactionThresholdTokens)) {
        let customCompactionInstructions: string | undefined;
        if (params.beforeCompact) {
          const result = await params.beforeCompact(toConversationMessages(session.messages));
          customCompactionInstructions = result?.customInstructions ?? undefined;
        }
        await session.compact(customCompactionInstructions || compactionInstructions());
        compacted = true;
      }

      await session.prompt(params.userPrompt);

      if (shouldCompact(session.messages, this.llm.chat.compactionThresholdTokens)) {
        let customCompactionInstructions: string | undefined;
        if (params.beforeCompact) {
          const result = await params.beforeCompact(toConversationMessages(session.messages));
          customCompactionInstructions = result?.customInstructions ?? undefined;
        }
        await session.compact(customCompactionInstructions || compactionInstructions());
        compacted = true;
      }

      const message = session.getLastAssistantText() || "";
      const lastError = getLastAssistantError(session.messages);
      if (!message && lastError) {
        await this.runtimeLogger?.error({
          component: "agent",
          type: "agent_run_failed",
          sessionId: params.sessionKey,
          data: {
            error: lastError,
          },
        });
        throw new Error(lastError);
      }

      unsubscribe();
      await this.runtimeLogger?.info({
        component: "agent",
        type: "agent_run_completed",
        sessionId: params.sessionKey,
        data: {
          toolCallCount: toolCalls.length,
          compacted,
        },
      });
      return {
        sessionFile: session.sessionFile || null,
        sessionId: params.sessionKey,
        message,
        compacted,
        toolCalls,
        usage,
      };
    } finally {
      session.dispose();
    }
  }

  async clearPersistentSession(sessionKey: string): Promise<void> {
    const index = await this.loadSessionIndex();
    if (!(sessionKey in index)) {
      return;
    }
    delete index[sessionKey];
    await mkdir(this.sessionRoot, { recursive: true });
    await writeFile(this.sessionIndexPath, JSON.stringify(index, null, 2) + "\n", "utf8");
  }

  private async getPersistentSessionManager(sessionKey: string): Promise<SessionManager> {
    const index = await this.loadSessionIndex();
    const existing = index[sessionKey];
    if (existing) {
      return SessionManager.open(existing);
    }
    return SessionManager.create(this.cwd, this.sessionRoot);
  }

  private async loadSessionIndex(): Promise<SessionIndex> {
    try {
      const raw = await readFile(this.sessionIndexPath, "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      );
    } catch {
      return {};
    }
  }

  private async storeSessionFile(sessionKey: string, sessionFile: string): Promise<void> {
    const index = await this.loadSessionIndex();
    index[sessionKey] = sessionFile;
    await writeFile(this.sessionIndexPath, JSON.stringify(index, null, 2) + "\n", "utf8");
  }

  private composeSystemPrompt(basePrompt: string): string {
    const skillsPrompt = this.skills.buildPrompt();
    return [basePrompt.trim(), skillsPrompt].filter(Boolean).join("\n\n").trim();
  }
}

function normalizeArgs(args: unknown): Record<string, unknown> {
  if (args && typeof args === "object" && !Array.isArray(args)) {
    return args as Record<string, unknown>;
  }
  return {};
}

function shouldCompact(messages: unknown[], compactionThresholdTokens: number): boolean {
  const estimatedTokens = estimateTokens(messages);
  return estimatedTokens >= compactionThresholdTokens;
}

function estimateTokens(messages: unknown[]): number {
  const totalChars = messages.reduce<number>((sum, message) => sum + extractMessageText(message).length, 0);
  return Math.max(1, Math.floor(totalChars / 4));
}

function extractMessageText(message: unknown): string {
  if (!message || typeof message !== "object") {
    return "";
  }
  const typedMessage = message as Record<string, unknown>;
  const content = typedMessage.content;
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((item) => {
      if (!item || typeof item !== "object") {
        return "";
      }
      const typedItem = item as Record<string, unknown>;
      return typedItem.type === "text" && typeof typedItem.text === "string" ? typedItem.text : "";
    })
    .join("\n");
}

function getLastAssistantError(messages: unknown[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const entry = messages[index];
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const typedEntry = entry as Record<string, unknown>;
    if (typedEntry.role !== "assistant") {
      continue;
    }
    if (typedEntry.stopReason === "error" && typeof typedEntry.errorMessage === "string") {
      return typedEntry.errorMessage;
    }
  }
  return null;
}

function toConversationMessages(messages: unknown[]): ConversationMessage[] {
  return messages
    .map((message) => {
      if (!message || typeof message !== "object") {
        return null;
      }
      const typedMessage = message as Record<string, unknown>;
      const role = typedMessage.role;
      if (role !== "system" && role !== "user" && role !== "assistant") {
        return null;
      }
      return {
        role,
        content: extractMessageText(message),
        timestamp: new Date().toISOString(),
      } satisfies ConversationMessage;
    })
    .filter((item): item is ConversationMessage => item !== null);
}

function compactionInstructions(): string {
  return [
    "Summarize the earlier session for future stock-claw turns.",
    "Preserve durable user preferences, risk limits, exclusions, watchlist priorities, pending trade intentions, and portfolio-relevant constraints.",
    "Do not include secrets or API keys.",
    "Keep the summary concise and action-oriented.",
  ].join(" ");
}

function readMessageRole(message: unknown): string | null {
  if (!message || typeof message !== "object") {
    return null;
  }
  const typed = message as Record<string, unknown>;
  return typeof typed.role === "string" ? typed.role : null;
}

function readUsage(message: unknown) {
  if (!message || typeof message !== "object") {
    return null;
  }
  const typed = message as Record<string, unknown>;
  const usage = typed.usage;
  if (!usage || typeof usage !== "object") {
    return null;
  }
  const raw = usage as Record<string, unknown>;
  const cost = (raw.cost && typeof raw.cost === "object" ? raw.cost : {}) as Record<string, unknown>;
  return {
    input: numeric(raw.input),
    output: numeric(raw.output),
    cacheRead: numeric(raw.cacheRead),
    cacheWrite: numeric(raw.cacheWrite),
    totalTokens: numeric(raw.totalTokens),
    contextTokens: numeric(raw.totalTokens),
    cost: {
      input: numeric(cost.input),
      output: numeric(cost.output),
      cacheRead: numeric(cost.cacheRead),
      cacheWrite: numeric(cost.cacheWrite),
      total: numeric(cost.total),
    },
  };
}

function emptyUsageAggregate(): UsageAggregate {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    turns: 0,
    contextTokens: 0,
  };
}

function mergeUsageAggregate(target: UsageAggregate, usage: ReturnType<typeof readUsage>): void {
  if (!usage) {
    return;
  }
  target.input += usage.input;
  target.output += usage.output;
  target.cacheRead += usage.cacheRead;
  target.cacheWrite += usage.cacheWrite;
  target.totalTokens += usage.totalTokens;
  target.cost.input += usage.cost.input;
  target.cost.output += usage.cost.output;
    target.cost.cacheRead += usage.cost.cacheRead;
    target.cost.cacheWrite += usage.cost.cacheWrite;
    target.cost.total += usage.cost.total;
    target.turns += 1;
    target.contextTokens = usage.contextTokens || usage.totalTokens || target.contextTokens;
  }

function numeric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
