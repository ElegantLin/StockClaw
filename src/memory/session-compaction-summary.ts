import type { ConversationMessage } from "../types.js";
import type { PromptRegistry } from "../prompts/registry.js";
import type { PiRuntime } from "../pi/runtime.js";

export async function runSessionCompactionSummaryTurn(params: {
  piRuntime: PiRuntime;
  prompts: PromptRegistry;
  sessionId: string;
  transcript: ConversationMessage[];
  intent: string;
}): Promise<string> {
  const systemPrompt = await params.prompts.composeWorkflowPrompt("session_compaction_summary/10_system");
  const userPrompt = await params.prompts.composeWorkflowPrompt("session_compaction_summary/20_user");
  const transcript = formatTranscriptForCompactionSummary(params.transcript);

  const run = await params.piRuntime.runEphemeral({
    sessionKey: `${params.sessionId}:session-compaction-summary:${Date.now()}`,
    systemPrompt,
    userPrompt: [
      userPrompt,
      "",
      `Current intent: ${params.intent}`,
      "",
      "Full current session transcript:",
      transcript || "(none)",
    ].join("\n"),
    customTools: [],
  });

  return run.message.trim();
}

export function formatTranscriptForCompactionSummary(messages: ConversationMessage[]): string {
  return messages
    .flatMap((message) => [
      `### ${message.role} ${message.timestamp}`,
      "",
      message.content.trim() || "(empty)",
      "",
    ])
    .join("\n")
    .trim();
}
