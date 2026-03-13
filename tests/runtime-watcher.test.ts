import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolvePromptWatchRoots, resolveSkillWatchRoots } from "../src/runtime/watcher.js";

describe("RuntimeWatcher", () => {
  it("watches only project-local and shared system skill roots", () => {
    const roots = resolveSkillWatchRoots({
      USERPROFILE: "C:\\Users\\tester",
    } as NodeJS.ProcessEnv);

    expect(roots).toEqual([
      path.resolve("skills"),
      path.resolve("C:\\Users\\tester", ".agents", "skills"),
    ]);
  });

  it("falls back to HOME when USERPROFILE is absent", () => {
    const roots = resolveSkillWatchRoots({
      HOME: "/tmp/demo-home",
    } as NodeJS.ProcessEnv);

    expect(roots).toContain(path.resolve("/tmp/demo-home", ".agents", "skills"));
    expect(roots).not.toContain(path.resolve(".agents", "skills"));
  });

  it("watches the configured prompt root", () => {
    const roots = resolvePromptWatchRoots({
      STOCK_CLAW_PROMPT_ROOT: "custom-prompts",
    } as NodeJS.ProcessEnv);

    expect(roots).toEqual([path.resolve("custom-prompts")]);
  });
});
