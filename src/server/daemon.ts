import { createServer, type Server } from "node:http";

import type { RuntimeEventLogger } from "../runtime-logging/logger.js";
import { WebApp } from "./app.js";

export class DaemonServer {
  private server: Server | null = null;

  constructor(
    private readonly app: WebApp,
    private readonly onStart?: () => Promise<void>,
    private readonly onStop?: () => Promise<void>,
    private readonly host: string = process.env.STOCK_CLAW_HOST || "127.0.0.1",
    private readonly port: number = Number(process.env.STOCK_CLAW_PORT || "8000"),
    private readonly runtimeLogger?: RuntimeEventLogger | null,
  ) {}

  async start(): Promise<void> {
    if (this.server) {
      return;
    }
    this.server = createServer((req, res) => {
      void this.app.handle(req, res).catch((error) => {
        res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
        res.end(
          JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      });
    });
    try {
      await new Promise<void>((resolve) => {
        this.server!.listen(this.port, this.host, resolve);
      });
      console.log(`stock-claw daemon listening on http://${this.host}:${this.port}`);
      await this.runtimeLogger?.info({
        component: "daemon",
        type: "daemon_started",
        data: {
          host: this.host,
          port: this.port,
        },
      });
      if (this.onStart) {
        await this.onStart();
      }
    } catch (error) {
      const server = this.server;
      this.server = null;
      if (server) {
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
        });
      }
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }
    const server = this.server;
    this.server = null;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await this.runtimeLogger?.info({
      component: "daemon",
      type: "daemon_stopped",
      data: {
        host: this.host,
        port: this.port,
      },
    });
    if (this.onStop) {
      await this.onStop();
    }
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }
}
