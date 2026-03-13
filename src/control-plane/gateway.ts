import type { ConfigSnapshot, OpsExecutionResult, RuntimeInspectionPayload, RuntimeStatusSnapshot } from "../types.js";
import type { RestartRequestResult } from "../restart/types.js";
import type { RuntimeManager } from "./runtime-manager.js";
import { ConfigService } from "./config-service.js";
import { OpsService } from "./ops-service.js";
import type { RestartController } from "../restart/controller.js";
import type { CronJob, CronJobCreateInput, CronJobPatch, CronInspectionPayload } from "../cron/types.js";
import type { CronService } from "../cron/service.js";

export class ControlPlaneGateway {
  private cronService?: CronService;

  constructor(
    private readonly config: ConfigService,
    private readonly ops: OpsService,
    private readonly restart?: RestartController,
    private readonly runtime?: RuntimeManager,
    cron?: CronService,
  ) {
    this.cronService = cron;
  }

  setCronService(cron: CronService): void {
    this.cronService = cron;
  }

  getConfig(target: "llm" | "mcp" | "all" = "all"): Promise<ConfigSnapshot> {
    return this.config.getSnapshot(target);
  }

  patchConfig(target: "llm" | "mcp", patch: string): Promise<ConfigSnapshot> {
    return this.config.patchConfig(target, patch);
  }

  applyConfig(target: "llm" | "mcp", raw: string): Promise<ConfigSnapshot> {
    return this.config.applyConfig(target, raw);
  }

  installMcp(params: {
    name: string;
    command: string;
    args: string[];
    cwd?: string;
    env?: Record<string, string>;
  }): Promise<OpsExecutionResult> {
    return this.ops.installMcp(params);
  }

  installSkill(params: { source: string; name?: string }): Promise<OpsExecutionResult> {
    return this.ops.installSkill(params);
  }

  verifyRuntime(target: "llm" | "mcp" | "all" = "all"): Promise<OpsExecutionResult> {
    return this.ops.verifyRuntime(target);
  }

  requestRestart(params: {
    sessionId: string;
    channel: "web" | "telegram";
    note: string;
    reason?: string;
  }): Promise<RestartRequestResult> | null {
    return this.restart ? this.restart.requestRestart(params) : null;
  }

  getRuntimeStatus(): RuntimeStatusSnapshot | null {
    return this.runtime?.getStatus() ?? null;
  }

  inspectRuntime(limit = 8): Promise<RuntimeInspectionPayload> | null {
    return this.runtime ? this.runtime.inspect(limit) : null;
  }

  reloadRuntime(reason = "manual"): Promise<RuntimeStatusSnapshot> | null {
    return this.runtime ? this.runtime.reloadNow(reason) : null;
  }

  inspectCron(): Promise<CronInspectionPayload> | null {
    return this.cronService ? this.cronService.inspect() : null;
  }

  listCronJobs(): Promise<CronJob[]> | null {
    return this.cronService ? this.cronService.listJobs() : null;
  }

  addCronJob(job: CronJobCreateInput): Promise<CronJob> | null {
    return this.cronService ? this.cronService.addJob(job) : null;
  }

  updateCronJob(jobId: string, patch: CronJobPatch): Promise<CronJob> | null {
    return this.cronService ? this.cronService.updateJob(jobId, patch) : null;
  }

  removeCronJob(jobId: string): Promise<{ ok: true; jobId: string }> | null {
    return this.cronService ? this.cronService.removeJob(jobId) : null;
  }

  runCronJob(jobId: string) {
    return this.cronService ? this.cronService.runJob(jobId, "manual") : null;
  }
}
