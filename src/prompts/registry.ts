import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { AgentProfileId } from "../types.js";

type PromptVariableResolver = () => Promise<string> | string;

export class PromptRegistry {
  constructor(
    private readonly root: string = "prompts",
    private readonly variables: Record<string, PromptVariableResolver> = {},
  ) {}

  async composeAgentPrompt(agentId: AgentProfileId): Promise<string> {
    const parts: string[] = [];
    parts.push(...(await this.readPromptDirectory(path.join(this.root, "shared"))));
    parts.push(...(await this.readPromptDirectory(path.join(this.root, "agents", agentId))));
    return this.combine(parts);
  }

  async composeWorkflowPrompt(workflowName: string): Promise<string> {
    const basePath = path.join(this.root, "workflows", workflowName);
    const filePath = `${basePath}.md`;
    if (await this.exists(filePath)) {
      return this.render(await readFile(filePath, "utf8"));
    }
    const files = await this.readPromptDirectory(basePath);
    if (files.length === 0) {
      throw new Error(`Unknown workflow prompt: ${workflowName}`);
    }
    return this.combine(files);
  }

  async composeSharedPrompt(name: string): Promise<string> {
    return this.readRequiredFile(path.join(this.root, "shared", `${name}.md`));
  }

  async listAgentPromptFiles(agentId: AgentProfileId): Promise<string[]> {
    return this.listMarkdownFiles(path.join(this.root, "agents", agentId));
  }

  async listSharedPromptFiles(): Promise<string[]> {
    return this.listMarkdownFiles(path.join(this.root, "shared"));
  }

  private async readRequiredFile(filePath: string): Promise<string> {
    await access(filePath);
    return this.render(await readFile(filePath, "utf8"));
  }

  private async readPromptDirectory(dirPath: string): Promise<string[]> {
    const files = await this.listMarkdownFiles(dirPath);
    return Promise.all(files.map((filePath) => readFile(filePath, "utf8").then((content) => this.render(content))));
  }

  private async listMarkdownFiles(dirPath: string): Promise<string[]> {
    await access(dirPath);
    const entries = await readdir(dirPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => path.join(dirPath, entry.name))
      .sort((left, right) => path.basename(left).localeCompare(path.basename(right)));
  }

  private async exists(targetPath: string): Promise<boolean> {
    try {
      await access(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  private async render(content: string): Promise<string> {
    let rendered = content;
    for (const [key, resolver] of Object.entries(this.variables)) {
      const marker = `{{${key}}}`;
      if (rendered.includes(marker)) {
        rendered = rendered.replaceAll(marker, await resolver());
      }
    }
    return rendered.trim();
  }

  private combine(parts: string[]): string {
    return parts.filter(Boolean).join("\n\n").trim();
  }
}
