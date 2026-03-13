#!/usr/bin/env node

import { runMcporter } from "../mcporter/runner.js";

try {
  const result = await runMcporter(process.argv.slice(2), process.env);
  if (result.stdout) {
    process.stdout.write(result.stdout.endsWith("\n") ? result.stdout : `${result.stdout}\n`);
  }
  process.exit(result.exitCode);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
