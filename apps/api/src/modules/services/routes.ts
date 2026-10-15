import { randomBytes } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { serviceApiKeys, services } from "../../db/schema";
import { hashApiKey } from "../../plugins/api-key-auth";
import { createServiceBodySchema } from "./schemas";

// PostgreSQL foreign_key_violation; Drizzle wraps the driver error in `cause`.
const isForeignKeyViolation = (error: unknown): boolean =>
  error instanceof Error &&
  error.cause instanceof Error &&
  "code" in error.cause &&
  error.cause.code === "23503";

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

    // The raw key is returned once and never stored; only its SHA-256 hash is.
    const rawKey = `sk_${randomBytes(32).toString("base64url")}`;

    let created;
    try {
      // One transaction, so a service is never left without its key.
      created = await app.db.transaction(async (tx) => {
        const [service] = await tx
          .insert(services)
          .values(result.data)
          .onConflictDoNothing({ target: services.name })
          .returning();
        if (!service) return null;

        const [apiKey] = await tx
          .insert(serviceApiKeys)
          .values({
            serviceId: service.id,
            name: "default",
            keyHash: hashApiKey(rawKey),
            keyPrefix: rawKey.slice(0, 12),
          })
          .returning({ id: serviceApiKeys.id, keyPrefix: serviceApiKeys.keyPrefix });
        return { service, apiKey };
      });
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        return reply.status(400).send({
          statusCode: 400,
          error: "Bad Request",
          message: "ownerTeamId does not reference an existing team",
        });
      }
      throw error;
    }

    if (!created) {
      return reply.status(409).send({
        statusCode: 409,
        error: "Conflict",
        message: "A service with this name already exists",
      });
    }

    return reply.status(201).send({
      service: created.service,
      apiKey: { ...created.apiKey, key: rawKey },
    });
  });
};
export default serviceRoutes;
