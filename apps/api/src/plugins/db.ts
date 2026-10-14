import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { createDb, type Database } from "../db/client";

declare module "fastify" {
  interface FastifyInstance {
    db: Database;
  }
}
const dbPlugin: FastifyPluginAsync = async (app) => {
  const connection = createDb();//stores the exposrts of the client.ts
  app.decorate("db", connection.db);


  app.addHook("onClose", async (instance) => {
    instance.log.info("Closing database connection");
    await connection.close();
  });
};
export default fp(dbPlugin, {
  name: "db",
  fastify: "5.x",
});
