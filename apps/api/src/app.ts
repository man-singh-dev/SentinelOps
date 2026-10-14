import Fastify from "fastify";
import errorHandler from "./plugins/error-handler";
import dbPlugin from "./plugins/db";
import serviceRoutes from "./modules/services/routes";
import eventRoutes from "./modules/events/routes";

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

  // --- Module routes (Step 2) ---
  app.register(serviceRoutes, { prefix: "/api/v1/services" });
  app.register(eventRoutes, { prefix: "/api/v1/events" });

  return app;
};
