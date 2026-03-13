import { readFile } from "node:fs/promises";
import path from "node:path";

import { parse as parseToml } from "smol-toml";

export class LlmConfigError extends Error {}

export interface LlmEndpointConfig {
  baseUrl: string;
  apiKey?: string;
  headers: Record<string, string>;
  timeoutSeconds: number;
}

export interface ChatModelConfig {
  provider: string;
  model: string;
  contextWindow: number;
  compactionThresholdTokens: number;
  maxOutputTokens: number;
  temperature?: number;
}

export interface LlmConfig {
  endpoint: LlmEndpointConfig;
  chat: ChatModelConfig;
}

export async function loadLlmConfig(env: NodeJS.ProcessEnv): Promise<LlmConfig> {
  const configPath = await resolveLlmConfigPath();
  if (configPath) {
    return loadLlmConfigFile(configPath, env, env.STOCK_CLAW_LLM_PROFILE?.trim());
  }
  throw new LlmConfigError("Missing required LLM config file: config/llm.local.toml");
}

export async function resolveLlmConfigPath(): Promise<string | null> {
  const preferred = path.resolve("config/llm.local.toml");
  try {
    await readFile(preferred, "utf8");
    return preferred;
  } catch {
    return null;
  }
}

async function loadLlmConfigFile(
  filePath: string,
  env: NodeJS.ProcessEnv,
  selection?: string,
): Promise<LlmConfig> {
  const absolutePath = path.resolve(filePath);
  const raw = await readFile(absolutePath, "utf8");
  const parsed = absolutePath.endsWith(".json") ? JSON.parse(raw) : parseToml(raw);
  const simple = tryLoadSimpleLlmConfig(parsed);
  if (simple) {
    return simple;
  }

  const root = ensureObject(parsed, "llm config");
  const models = ensureObject(root.models, "models");
  const providers = ensureObject(models.providers, "models.providers");
  const agents = ensureObject(root.agents, "agents");
  const defaults = ensureObject(agents.defaults, "agents.defaults");
  const configuredModels = ensureObject(defaults.models, "agents.defaults.models");
  const selectedModelRef = resolveSelectedModelRef(selection, defaults.model, configuredModels);
  const [providerId, modelId] = splitModelRef(selectedModelRef);
  const providerConfig = ensureObject(providers[providerId], `models.providers.${providerId}`);
  const modelConfig = ensureObject(configuredModels[selectedModelRef], `agents.defaults.models.${selectedModelRef}`);
  const params = ensureOptionalObject(modelConfig.params, `agents.defaults.models.${selectedModelRef}.params`);

  const apiKeyEnv = optional(providerConfig.apiKeyEnv) ?? optional(providerConfig.api_key_env);
  const apiKey =
    optional(providerConfig.apiKey) ??
    optional(providerConfig.api_key) ??
    (apiKeyEnv ? optional(env[apiKeyEnv]) : undefined);
  const headers = normalizeStringMap(providerConfig.headers);
  const contextWindow = toNumber(defaults.contextTokens ?? defaults.context_window, 200_000);
  return {
    endpoint: {
      baseUrl: required(
        optional(providerConfig.baseUrl) ?? optional(providerConfig.base_url),
        `models.providers.${providerId}.baseUrl`,
      ).replace(/\/+$/, ""),
      apiKey,
      headers,
      timeoutSeconds: toNumber(defaults.timeoutSeconds ?? defaults.timeout_seconds, 30),
    },
    chat: {
      provider: providerId,
      model: modelId,
      contextWindow,
      compactionThresholdTokens: resolveCompactionThreshold({
        defaults,
        fallbackContextWindow: contextWindow,
      }),
      maxOutputTokens: toNumber(params.maxTokens ?? params.max_output_tokens, 2_000),
      temperature: optionalNumber(params.temperature),
    },
  };
}

function tryLoadSimpleLlmConfig(parsed: unknown): LlmConfig | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const root = parsed as Record<string, unknown>;
  const llmNode = root.llm;
  if (!llmNode || typeof llmNode !== "object" || Array.isArray(llmNode)) {
    return null;
  }
  const llm = llmNode as Record<string, unknown>;
  const baseUrl = optional(llm.baseUrl) ?? optional(llm.base_url);
  const modelRef = optional(llm.modelRef) ?? optional(llm.model_ref);
  const model = optional(llm.model);
  const selected = modelRef ?? (model ? `openai/${model}` : undefined);
  if (!baseUrl || !selected) {
    return null;
  }
  const [providerId, modelId] = splitModelRef(selected);
  const contextWindow = toNumber(llm.contextTokens ?? llm.context_window, 200_000);
  return {
    endpoint: {
      baseUrl: baseUrl.replace(/\/+$/, ""),
      apiKey: optional(llm.apiKey) ?? optional(llm.api_key),
      headers: normalizeStringMap(llm.headers),
      timeoutSeconds: toNumber(llm.timeoutSeconds ?? llm.timeout_seconds, 30),
    },
    chat: {
      provider: providerId,
      model: modelId,
      contextWindow,
      compactionThresholdTokens: toNumber(
        llm.compactionThresholdTokens ?? llm.compaction_threshold_tokens,
        defaultCompactionThreshold(contextWindow),
      ),
      maxOutputTokens: toNumber(llm.maxOutputTokens ?? llm.max_output_tokens, 2_000),
      temperature: optionalNumber(llm.temperature),
    },
  };
}

function resolveCompactionThreshold(params: {
  defaults: Record<string, unknown>;
  fallbackContextWindow: number;
}): number {
  return toNumber(
    params.defaults.compactionThresholdTokens ?? params.defaults.compaction_threshold_tokens,
    defaultCompactionThreshold(params.fallbackContextWindow),
  );
}

function defaultCompactionThreshold(contextWindow: number): number {
  return Math.floor(contextWindow * 0.8);
}

function resolveSelectedModelRef(
  selection: string | undefined,
  modelNode: unknown,
  configuredModels: Record<string, unknown>,
): string {
  if (selection) {
    const trimmed = selection.trim();
    if (trimmed in configuredModels) {
      return trimmed;
    }
    for (const [modelRef, value] of Object.entries(configuredModels)) {
      const entry = ensureObject(value, `agents.defaults.models.${modelRef}`);
      if (optional(entry.alias) === trimmed) {
        return modelRef;
      }
    }
    throw new LlmConfigError(`Configured model selection '${trimmed}' was not found.`);
  }

  if (typeof modelNode === "string" && modelNode.trim()) {
    return modelNode.trim();
  }
  const modelObject = ensureObject(modelNode, "agents.defaults.model");
  return required(optional(modelObject.primary), "agents.defaults.model.primary");
}

function ensureObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LlmConfigError(`${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function ensureOptionalObject(value: unknown, field: string): Record<string, unknown> {
  if (value == null) {
    return {};
  }
  return ensureObject(value, field);
}

function normalizeStringMap(value: unknown): Record<string, string> {
  if (!value) {
    return {};
  }
  const raw = ensureObject(value, "headers");
  return Object.fromEntries(
    Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function splitModelRef(value: string): [string, string] {
  const [provider, ...rest] = value.split("/");
  const model = rest.join("/");
  if (!provider?.trim() || !model.trim()) {
    throw new LlmConfigError("Model references must use the form 'provider/model'.");
  }
  return [provider.trim(), model.trim()];
}

function required(value: string | undefined, field: string): string {
  if (!value?.trim()) {
    throw new LlmConfigError(`Missing required LLM config value: ${field}`);
  }
  return value.trim();
}

function optional(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function toNumber(value: unknown, fallback: number): number {
  if (value == null || value === "") {
    return fallback;
  }
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    throw new LlmConfigError(`Expected a numeric config value, received '${String(value)}'.`);
  }
  return numeric;
}

function optionalNumber(value: unknown): number | undefined {
  if (value == null || value === "") {
    return undefined;
  }
  return toNumber(value, 0);
}
