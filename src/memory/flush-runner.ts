import type { ToolCallRecord, ConversationMessage } from "../types.js";
import type { PromptRegistry } from "../prompts/registry.js";
import type { PiRuntime } from "../pi/runtime.js";
import type { MemoryService } from "./service.js";
import { DURABLE_MEMORY_CATEGORIES } from "./bootstrap-files.js";
import type { PortfolioStore } from "../portfolio/store.js";
import type { ToolPolicyService } from "../control/tool-policy.js";
import {
  MEMORY_FLUSH_SKIP_TOKEN,
  resolveMemoryFlushDate,
  resolveMemoryFlushPrompt,
} from "./flush.js";
import { runSessionCompactionSummaryTurn } from "./session-compaction-summary.js";

export async function runMemoryFlushTurn(params: {
  piRuntime: PiRuntime;
  prompts: PromptRegistry;
  memory: MemoryService;
  portfolio: PortfolioStore;
  policy: ToolPolicyService;
  sessionId: string;
  transcript: ConversationMessage[];
  intent: string;
  timestamp?: string;
}): Promise<{ skipped: boolean; message: string; toolCalls: ToolCallRecord[] }> {
  const date = resolveMemoryFlushDate(params.timestamp);
  const systemPrompt = await params.prompts.composeWorkflowPrompt("memory_flush/10_system");
  const promptTemplate = await params.prompts.composeWorkflowPrompt("memory_flush/20_user");
  const prompt = resolveMemoryFlushPrompt(promptTemplate, params.timestamp);
  const memoryContext = await loadDurableMemory(params.memory);
  const portfolioSnapshot = await params.portfolio.load();
  const sessionSummary = await runSessionCompactionSummaryTurn({
    piRuntime: params.piRuntime,
    prompts: params.prompts,
    sessionId: params.sessionId,
    transcript: params.transcript,
    intent: params.intent,
  });

  const run = await params.piRuntime.runEphemeral({
    sessionKey: `${params.sessionId}:memory-flush:${Date.now()}`,
    systemPrompt,
    userPrompt: [
      prompt,
      "",
      `Current intent: ${params.intent}`,
      `Target daily memory file: memory/${date}.md`,
      "",
      "Portfolio snapshot:",
      JSON.stringify(portfolioSnapshot, null, 2),
      "",
      "Existing durable memory excerpt:",
      memoryContext || "(none)",
      "",
      "Current session compaction summary:",
      sessionSummary || "(none)",
    ].join("\n"),
    customTools: params.policy.createNamedTools(["memory_read", "memory_append_daily_log"], {
      sessionKey: params.sessionId,
      profileId: "orchestrator",
    }),
  });

  const message = run.message.trim();
  return {
    skipped: !message || message.toUpperCase() === MEMORY_FLUSH_SKIP_TOKEN,
    message,
    toolCalls: run.toolCalls,
  };
}

async function loadDurableMemory(memory: MemoryService): Promise<string> {
  const sections = await Promise.all(DURABLE_MEMORY_CATEGORIES.map((category) => memory.readCategory(category)));
  return sections
    .flat()
    .map((document) => `## ${document.path}\n\n${document.content.trim()}`)
    .join("\n\n")
    .trim();
}
