import path from "node:path";

import { tokenizeCommand } from "../tools/support.js";

export interface CommandInvocationSummary {
  route: "shell" | "mcporter" | "skill_read" | "skill_exec";
  skillName?: string;
  mcpServer?: string;
  mcpTool?: string;
}

export function classifyCommandInvocation(command: string): CommandInvocationSummary {
  const trimmed = command.trim();
  if (!trimmed) {
    return { route: "shell" };
  }
  const tokens = tokenizeCommand(trimmed);
  const mcporterTarget = extractMcporterTarget(tokens);
  if (mcporterTarget) {
    return {
      route: "mcporter",
      mcpServer: mcporterTarget.server,
      mcpTool: mcporterTarget.tool,
    };
  }

  const skillPath = extractSkillPath(trimmed);
  if (skillPath) {
    return {
      route: isSkillReadCommand(trimmed) ? "skill_read" : "skill_exec",
      skillName: skillPath,
    };
  }

  return { route: "shell" };
}

function extractMcporterTarget(tokens: string[]): { server?: string; tool?: string } | null {
  const direct = tokens[0] === "mcporter";
  const npmRun =
    tokens[0] === "npm" &&
    tokens[1] === "run" &&
    tokens[2] === "mcporter";
  if (!direct && !npmRun) {
    return null;
  }
  const callIndex = tokens.indexOf("call");
  if (callIndex === -1 || callIndex + 1 >= tokens.length) {
    return {};
  }
  const target = tokens[callIndex + 1] || "";
  const [server, tool] = target.split(".", 2);
  return { server, tool };
}

function extractSkillPath(command: string): string | null {
  const normalized = command.replace(/\\/g, "/");
  const patterns = [
    /\/skills\/([^/]+)\//i,
    /\/\.agents\/skills\/([^/]+)\//i,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) {
      return path.basename(match[1]);
    }
  }
  return null;
}

function isSkillReadCommand(command: string): boolean {
  const lowered = command.toLowerCase();
  return lowered.includes("skill.md") &&
    (lowered.includes("cat ") || lowered.includes("type ") || lowered.includes("get-content"));
}
