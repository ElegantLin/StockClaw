import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { formatSkillsForPrompt, loadSkillsFromDir, type Skill } from "@mariozechner/pi-coding-agent";

function compactHomePath(filePath: string): string {
  const home = os.homedir();
  if (!home) {
    return filePath;
  }
  const normalizedHome = path.resolve(home);
  const normalizedPath = path.resolve(filePath);
  if (normalizedPath === normalizedHome) {
    return "~";
  }
  const prefix = normalizedHome + path.sep;
  if (normalizedPath.startsWith(prefix)) {
    return `~${path.sep}${normalizedPath.slice(prefix.length)}`;
  }
  return filePath;
}

function listChildDirs(root: string): string[] {
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules")
      .map((entry) => path.join(root, entry.name));
  } catch {
    return [];
  }
}

function unwrapSkills(loaded: unknown): Skill[] {
  if (Array.isArray(loaded)) {
    return loaded as Skill[];
  }
  if (loaded && typeof loaded === "object" && "skills" in loaded) {
    const skills = (loaded as { skills?: unknown }).skills;
    if (Array.isArray(skills)) {
      return skills as Skill[];
    }
  }
  return [];
}

function loadSkillDirs(root: string, source: string): Skill[] {
  const skillDirs = listChildDirs(root).filter((dir) => fs.existsSync(path.join(dir, "SKILL.md")));
  return skillDirs.flatMap((dir) => unwrapSkills(loadSkillsFromDir({ dir, source })));
}

function dedupeSkills(skills: Skill[]): Skill[] {
  const merged = new Map<string, Skill>();
  for (const skill of skills) {
    merged.set(skill.name, skill);
  }
  return Array.from(merged.values()).sort((left, right) => left.name.localeCompare(right.name));
}

function formatSkills(skills: Skill[]): string {
  if (skills.length === 0) {
    return "";
  }
  return formatSkillsForPrompt(
    skills.map((skill) => ({
      ...skill,
      filePath: compactHomePath(skill.filePath),
    })),
  ).trim();
}

export class SkillRegistry {
  constructor(
    private readonly roots: string[] = [
      path.resolve("skills"),
      path.resolve(os.homedir(), ".agents", "skills"),
    ],
  ) {}

  list(): Skill[] {
    const loaded = this.roots.flatMap((root, index) => loadSkillDirs(root, `stock-claw-${index}`));
    return dedupeSkills(loaded);
  }

  buildPrompt(): string {
    return formatSkills(this.list());
  }
}
