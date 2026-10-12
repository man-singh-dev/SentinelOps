import Fastify from "fastify";
import errorHandler from "./plugins/error-handler";
import dbPlugin from "./plugins/db";

export const buildServer = () => {
  const app = Fastify({
    logger: {
      level: "info",
    },
  });

  // Global error normalisation — must be registered before routes.
  app.register(errorHandler);

  // Attaches app.db and registers the onClose pool-drain hook.
  app.register(dbPlugin);

  // Basic liveness probe — no auth, no DB call.
  app.get("/health", () => {
    return { status: "ok" };
  });

  return app;
};
