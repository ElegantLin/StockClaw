import { WebApp } from "./server/app.js";
import { DaemonServer } from "./server/daemon.js";
import { RuntimeManager } from "./runtime/manager.js";
import { createTelegramExtension, type TelegramExtension } from "./telegram/service.js";
import { RestartController } from "./restart/controller.js";
import { deliverRestartSentinelOnStartup } from "./restart/startup-delivery.js";

export interface ApplicationContainer {
  daemon: DaemonServer;
  app: WebApp;
  runtime: RuntimeManager;
  telegram: TelegramExtension | null;
  restart: RestartController;
}

export async function buildApplication(env: NodeJS.ProcessEnv = process.env): Promise<ApplicationContainer> {
  const restart = new RestartController(env);
  const runtime = new RuntimeManager(env, { restartController: restart });
  await runtime.start();
  const app = new WebApp(runtime);
  const telegram = await createTelegramExtension(env, runtime);
  runtime.attachTelegramExtension(telegram);
  const daemon = new DaemonServer(
    app,
    async () => {
      if (telegram) {
        try {
          await telegram.start();
        } catch (error) {
          console.warn(
            `stock-claw telegram extension disabled for this run: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      await deliverRestartSentinelOnStartup({
        env,
        telegram,
        appSessionPath: env.STOCK_CLAW_APP_SESSION_PATH || "data/app-sessions.json",
      });
    },
    async () => {
      await telegram?.close();
      await runtime.close();
    },
    process.env.STOCK_CLAW_HOST || "127.0.0.1",
    Number(process.env.STOCK_CLAW_PORT || "8000"),
    runtime.runtimeLogger,
  );
  return { daemon, app, runtime, telegram, restart };
}
