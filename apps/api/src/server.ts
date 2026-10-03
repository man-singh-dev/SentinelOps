import Fastify from "fastify";
import { env } from "./config/env";
import errorHandler from "./plugins/error-handler";

const buildServer = () => {
  const app = Fastify({
    logger: {
      level: "info",
    },
  });

  app.register(errorHandler);

  app.get("/health", () => {
    return {
      status: "ok",
    };
  });
 

  return app;
};

const start = async () => {
  const app = buildServer();

  try {
    await app.listen({
      port: env.PORT,
    });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

void start();
//tells ESLint:
//"I know this function returns a Promise. I'm intentionally starting it here without awaiting it."