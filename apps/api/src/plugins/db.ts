import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { createDb, type Database } from "../db/client";

// Type augmentation so `app.db` / `request.server.db` is typed everywhere.
declare module "fastify" {
  interface FastifyInstance {
    db: Database;
  }
}
// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async signature
const dbPlugin: FastifyPluginAsync = async (app) => {
  const connection = createDb();
  app.decorate("db", connection.db);

  // Runs on app.close() — drains the postgres.js pool so the process can exit cleanly.
  app.addHook("onClose", async (instance) => {
    instance.log.info("Closing database connection");
    await connection.close();
  });
};
// fastify-plugin skips encapsulation so the `db` decorator is visible to the whole app,
// not just this plugin's scope.
export default fp(dbPlugin, {
  name: "db",
  fastify: "5.x",
});
