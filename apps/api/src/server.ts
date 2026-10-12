import { env } from "./config/env";
import { buildServer } from "./app";


const app = buildServer();
let isShuttingDown = false;

const shutdown = async (signal: string): Promise<void> => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  app.log.info({ signal }, "Shutdown signal received — closing server");

  try {
    await app.close();
    app.log.info("Server closed cleanly");
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, "Error during shutdown");
    process.exit(1);
  }
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));


const start = async (): Promise<void> => {
  try {
    await app.listen({
      port: env.PORT,
      host: "0.0.0.0",
    });
  } catch (err) {
    app.log.error({ err }, "Failed to start server");
    process.exit(1);
  }
};

void start();
