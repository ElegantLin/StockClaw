import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { SkillRegistry } from "../src/skills/registry.js";

describe("SkillRegistry", () => {
  it("builds an available_skills prompt from SKILL.md roots", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "stock-claw-skills-"));
    const skillDir = path.join(root, "demo-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      path.join(skillDir, "SKILL.md"),
      [
        "---",
        "name: demo-skill",
        "description: Demo skill for tests.",
        "---",
        "",
        "# Demo Skill",
      ].join("\n"),
      "utf8",
    );

    const registry = new SkillRegistry([root]);
    const prompt = registry.buildPrompt();
    expect(prompt).toContain("<available_skills>");
    expect(prompt).toContain("<name>demo-skill</name>");
    expect(prompt).toContain("Demo skill for tests.");
  });
});
