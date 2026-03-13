import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { RuntimeManager } from "../runtime/manager.js";
import { renderControlPanelHtml } from "./ui.js";
import type { CronJobCreateInput, CronJobPatch } from "../cron/types.js";
import type {
  HttpResponse,
  PortfolioSnapshot,
  TradeExecutionRequest,
  UserRequest,
} from "../types.js";

export class WebApp {
  constructor(private readonly runtime: RuntimeManager) {}

  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const response = await this.route(req);
    res.writeHead(response.statusCode, response.headers);
    res.end(response.body);
  }

  private async route(req: IncomingMessage): Promise<HttpResponse> {
    const method = req.method || "GET";
    const url = new URL(req.url || "/", "http://127.0.0.1");

    if (method === "GET" && url.pathname === "/health") {
      return json(200, { status: "ok", runtime: this.runtime.getStatus() });
    }

    if (method === "GET" && url.pathname === "/api/runtime") {
      return json(200, await this.runtime.inspect());
    }

    if (method === "GET" && url.pathname === "/api/cron") {
      const orchestrator = await this.runtime.getOrchestrator();
      return json(200, await orchestrator.inspectCron());
    }

    if (method === "POST" && url.pathname === "/api/cron") {
      const orchestrator = await this.runtime.getOrchestrator();
      const body = (await readJson(req)) as CronJobCreateInput;
      return json(200, await orchestrator.addCronJob(body));
    }

    if (method === "PATCH" && url.pathname.startsWith("/api/cron/")) {
      const orchestrator = await this.runtime.getOrchestrator();
      const jobId = decodeURIComponent(url.pathname.slice("/api/cron/".length));
      const body = (await readJson(req)) as CronJobPatch;
      return json(200, await orchestrator.updateCronJob(jobId, body));
    }

    if (method === "DELETE" && url.pathname.startsWith("/api/cron/")) {
      const orchestrator = await this.runtime.getOrchestrator();
      const jobId = decodeURIComponent(url.pathname.slice("/api/cron/".length));
      return json(200, await orchestrator.removeCronJob(jobId));
    }

    if (method === "POST" && url.pathname.startsWith("/api/cron/") && url.pathname.endsWith("/run")) {
      const orchestrator = await this.runtime.getOrchestrator();
      const jobId = decodeURIComponent(
        url.pathname.slice("/api/cron/".length, -"/run".length),
      );
      return json(200, await orchestrator.runCronJob(jobId));
    }

    if (method === "POST" && url.pathname === "/api/runtime/reload") {
      const body = (await readJson(req)) as Record<string, unknown>;
      const reason = stringValue(body.reason) || "manual";
      return json(200, await this.runtime.reloadNow(reason));
    }

    if (method === "POST" && url.pathname === "/api/runtime/restart") {
      const orchestrator = await this.runtime.getOrchestrator();
      const body = (await readJson(req)) as Record<string, unknown>;
      return json(
        200,
        await orchestrator.requestRestart({
          sessionId: stringValue(body.sessionId) || "web:control-panel",
          channel: "web",
          note: stringValue(body.note) || "stock-claw restarted successfully.",
          reason: stringValue(body.reason),
        }),
      );
    }

    if (method === "GET" && url.pathname === "/") {
      return html(200, renderControlPanelHtml());
    }

    if (method === "GET" && url.pathname === "/favicon.ico") {
      return {
        statusCode: 204,
        headers: {
          "cache-control": "no-store",
        },
        body: "",
      };
    }

    if (method === "POST" && url.pathname === "/api/sessions") {
      const orchestrator = await this.runtime.getOrchestrator();
      const body = (await readJson(req)) as Record<string, unknown>;
      return json(
        200,
        await orchestrator.createSession({
          sessionId: stringValue(body.sessionId),
          userId: stringValue(body.userId),
          channel: "web",
        }),
      );
    }

    if (method === "GET" && url.pathname.startsWith("/api/sessions/")) {
      const orchestrator = await this.runtime.getOrchestrator();
      const tail = decodeURIComponent(url.pathname.slice("/api/sessions/".length));
      if (tail.endsWith("/status")) {
        const sessionId = tail.slice(0, -"/status".length);
        const requestId = url.searchParams.get("requestId") || undefined;
        return json(200, await orchestrator.getSessionStatus(sessionId, requestId));
      }
      if (tail.endsWith("/spawns")) {
        const sessionId = tail.slice(0, -"/spawns".length);
        const requestId = url.searchParams.get("requestId") || undefined;
        return json(200, await orchestrator.getSessionSpawns(sessionId, requestId));
      }
      const sessionId = tail;
      return json(200, await orchestrator.getSession(sessionId));
    }

    if (method === "POST" && url.pathname.endsWith("/messages") && url.pathname.startsWith("/api/sessions/")) {
      const orchestrator = await this.runtime.getOrchestrator();
      const sessionId = decodeURIComponent(
        url.pathname.slice("/api/sessions/".length, -"/messages".length),
      );
      const body = (await readJson(req)) as Record<string, unknown>;
      const request: UserRequest = {
        requestId: stringValue(body.requestId) || randomUUID(),
        channel: "web",
        userId: stringValue(body.userId) || "web-user",
        sessionId,
        message: stringValue(body.message) || "",
        timestamp: new Date().toISOString(),
        metadata:
          body.metadata && typeof body.metadata === "object"
            ? (body.metadata as Record<string, unknown>)
            : {},
      };
      return json(200, await orchestrator.handle(request));
    }

    if (method === "GET" && url.pathname === "/api/portfolio") {
      const orchestrator = await this.runtime.getOrchestrator();
      return json(200, await orchestrator.getPortfolioPayload());
    }

    if (method === "PUT" && url.pathname === "/api/portfolio") {
      const orchestrator = await this.runtime.getOrchestrator();
      const body = (await readJson(req)) as PortfolioSnapshot;
      return json(200, await orchestrator.importPortfolio(body));
    }

    if (method === "POST" && url.pathname === "/api/trades/execute") {
      const orchestrator = await this.runtime.getOrchestrator();
      const body = (await readJson(req)) as TradeExecutionRequest;
      return json(200, await orchestrator.executeTrade(body));
    }

    if (method === "GET" && url.pathname === "/api/config") {
      const orchestrator = await this.runtime.getOrchestrator();
      const target = readTarget(url.searchParams.get("target"));
      return json(200, await orchestrator.getConfig(target));
    }

    if (method === "PATCH" && url.pathname === "/api/config") {
      const orchestrator = await this.runtime.getOrchestrator();
      const body = (await readJson(req)) as Record<string, unknown>;
      const target = readWriteTarget(stringValue(body.target));
      return json(
        200,
        await orchestrator.patchConfig(
          target,
          stringValue(body.patch) || "{}",
        ),
      );
    }

    if (method === "POST" && url.pathname === "/api/ops/install") {
      const orchestrator = await this.runtime.getOrchestrator();
      const body = (await readJson(req)) as Record<string, unknown>;
      const kind = stringValue(body.kind);
      if (kind === "mcp") {
        return json(
          200,
          await orchestrator.installOperation({
            kind: "mcp",
            name: stringValue(body.name) || "unnamed",
            command: stringValue(body.command) || "",
            args: Array.isArray(body.args) ? body.args.filter((item): item is string => typeof item === "string") : [],
            cwd: stringValue(body.cwd),
            env:
              body.env && typeof body.env === "object"
                ? Object.fromEntries(
                    Object.entries(body.env).filter(
                      (entry): entry is [string, string] => typeof entry[1] === "string",
                    ),
                  )
                : {},
          }),
        );
      }
      return json(
        200,
        await orchestrator.installOperation({
          kind: "skill",
          source: stringValue(body.source) || "",
          name: stringValue(body.name),
        }),
      );
    }

    return json(404, { error: "Not Found" });
  }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

function json(statusCode: number, payload: unknown): HttpResponse {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
    body: JSON.stringify(payload),
  };
}

function html(statusCode: number, body: string): HttpResponse {
  return {
    statusCode,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
    body,
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readTarget(value: string | null): "llm" | "mcp" | "all" {
  return value === "llm" || value === "mcp" || value === "all" ? value : "all";
}

function readWriteTarget(value: string | undefined): "llm" | "mcp" {
  return value === "llm" ? "llm" : "mcp";
}
