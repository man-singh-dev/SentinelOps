import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { serviceApiKeys } from "../db/schema";

declare module "fastify" {
  interface FastifyRequest {
    // Set by authenticateApiKey; the only trusted source of the caller's service.
    serviceId?: string;
  }
}

// Only SHA-256 hashes are stored (service_api_keys.key_hash), never the raw key.
export const hashApiKey = (rawKey: string): string =>
  createHash("sha256").update(rawKey).digest("hex");

// Route-level preHandler: resolves X-API-Key to a non-revoked key and its service.
export const authenticateApiKey = async (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const header = request.headers["x-api-key"];
  const rawKey = typeof header === "string" ? header.trim() : "";

  const [key] = rawKey
    ? await request.server.db
        .select({ serviceId: serviceApiKeys.serviceId })
        .from(serviceApiKeys)
        .where(
          and(
            eq(serviceApiKeys.keyHash, hashApiKey(rawKey)),
            eq(serviceApiKeys.isRevoked, false),
          ),
        )
        .limit(1)
    : [];

  if (!key) {
    return reply.status(401).send({
      statusCode: 401,
      error: "Unauthorized",
      message: "Missing or invalid API key",
    });
  }

  request.serviceId = key.serviceId;
};
