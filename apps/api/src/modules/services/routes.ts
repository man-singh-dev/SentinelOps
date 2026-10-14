import type { FastifyPluginAsync } from "fastify";
import { createServiceBodySchema } from "./schemas";
// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async signature
const serviceRoutes: FastifyPluginAsync = async (app) => {
  app.post("/", async (request, reply) => {
    const result = createServiceBodySchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        message: "Validation failed",
        issues: result.error.issues,
      });
    }
    return reply.status(501).send({
      statusCode: 501,
      error: "Not Implemented",
      message: "Service registration is not yet implemented",
    });
  });
};
export default serviceRoutes;
