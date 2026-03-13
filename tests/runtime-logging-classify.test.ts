import { describe, expect, it } from "vitest";

import { classifyCommandInvocation } from "../src/runtime-logging/classify.js";

describe("classifyCommandInvocation", () => {
  it("classifies mcporter direct and npm-run calls", () => {
    expect(classifyCommandInvocation("mcporter call longport.get_quotes --output json")).toEqual({
      route: "mcporter",
      mcpServer: "longport",
      mcpTool: "get_quotes",
    });
    expect(classifyCommandInvocation("npm run mcporter -- call exa.web_search_exa --output json")).toEqual({
      route: "mcporter",
      mcpServer: "exa",
      mcpTool: "web_search_exa",
    });
  });

  it("classifies skill reads and executable skill workflows", () => {
    expect(classifyCommandInvocation("Get-Content D:\\github\\stock-claw\\skills\\agent-browser\\SKILL.md")).toEqual({
      route: "skill_read",
      skillName: "agent-browser",
    });
    expect(classifyCommandInvocation("uv run D:\\github\\stock-claw\\skills\\stock-analysis\\scripts\\analyze_stock.py AAPL")).toEqual({
      route: "skill_exec",
      skillName: "stock-analysis",
    });
  });

  it("falls back to plain shell classification", () => {
    expect(classifyCommandInvocation("git status")).toEqual({ route: "shell" });
  });
});
