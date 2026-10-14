import type { FastifyPluginAsync } from "fastify";
import { ingestEventBodySchema } from "./schemas";
const eventRoutes: FastifyPluginAsync = async (app) => {
  app.post("/", async (request, reply) => {
    const result = ingestEventBodySchema.safeParse(request.body);

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
      message: "Event ingestion is not yet implemented",
    });
  });
};

export default eventRoutes;
