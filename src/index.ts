import { buildApplication } from "./bootstrap.js";
import { triggerApplicationRestart } from "./restart/strategy.js";
import { describeConfiguredSetup, ensureFirstRunSetup } from "./setup/first-run.js";
import { createTelegramConsoleAdmin } from "./telegram/console-admin.js";

const setup = await ensureFirstRunSetup(process.env);
if (!setup.changed) {
  for (const line of await describeConfiguredSetup(process.env)) {
    console.log(line);
  }
}
const container = await buildApplication(process.env);
await container.daemon.start();
const telegramConsole = createTelegramConsoleAdmin(container.telegram);
let shuttingDown = false;

container.restart.setExecutor(async () => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  await telegramConsole?.close();
  const attempt = triggerApplicationRestart(process.env);
  if (!attempt.ok) {
    console.error(`stock-claw restart failed: ${attempt.detail ?? "unknown error"}`);
    await container.daemon.stop();
    process.exit(1);
  }
  await container.daemon.stop();
  process.exit(0);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void (async () => {
      if (shuttingDown) {
        return;
      }
      shuttingDown = true;
      await telegramConsole?.close();
      await container.daemon.stop();
      process.exit(0);
    })();
  });
}
