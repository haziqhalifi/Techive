/**
 * Process entry point. `app.ts` builds the app; this file owns the port and the signals.
 */

import { config } from "@/config";
import { createApp } from "./app";

const app = createApp();

const server = app.listen(config.port, () => {
  process.stdout.write(
    `HARVEST API listening on http://localhost:${config.port} (${config.nodeEnv}, seed ${config.seed}, llm ${config.llm.enabled ? "on" : "off"})\n`,
  );
});

function shutdown(signal: string): void {
  process.stdout.write(`\n${signal} received — closing server.\n`);
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
