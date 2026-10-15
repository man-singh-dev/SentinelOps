import { createHash } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { events } from "../../db/schema";
import { authenticateApiKey } from "../../plugins/api-key-auth";
import { ingestEventBodySchema } from "./schemas";

// Server-side fingerprint: SHA256(serviceId + "\n" + eventType). The README's
// normalized_error_signature component is deferred to the correlation phase.
const computeFingerprint = (serviceId: string, eventType: string): string =>
  createHash("sha256").update(`${serviceId}\n${eventType}`).digest("hex");

// eslint-disable-next-line @typescript-eslint/require-await -- FastifyPluginAsync requires async signature
const eventRoutes: FastifyPluginAsync = async (app) => {
  app.post("/", { preHandler: authenticateApiKey }, async (request, reply) => {
    const serviceId = request.serviceId;
    if (!serviceId) {
      throw new Error("authenticateApiKey did not set request.serviceId");
    }

    const result = ingestEventBodySchema.safeParse(request.body);

    if (!result.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        message: "Validation failed",
        issues: result.error.issues,
      });
    }
    const body = result.data;

    if (
      body.serviceId !== undefined &&
      body.serviceId.toLowerCase() !== serviceId.toLowerCase()
    ) {
      return reply.status(403).send({
        statusCode: 403,
        error: "Forbidden",
        message:
          "The supplied service ID does not match the authenticated service. Please verify your service ID.",
      });
    }

    // The (service_id, event_id) unique index makes retries and concurrent
    // duplicates safe: exactly one insert wins, the rest return no row.
    const [inserted] = await app.db
      .insert(events)
      .values({
        eventId: body.eventId,
        serviceId,
        eventType: body.eventType,
        severity: body.severity,
        fingerprint: computeFingerprint(serviceId, body.eventType),
        message: body.message,
        metadata: body.metadata,
        occurredAt: new Date(body.timestamp),
      })
      .onConflictDoNothing({ target: [events.serviceId, events.eventId] })
      .returning({ id: events.id });

    if (!inserted) {
      return reply.status(200).send({ eventId: body.eventId, duplicate: true });
    }
    return reply
      .status(201)
      .send({ id: inserted.id, eventId: body.eventId, duplicate: false });
  });
};

export default eventRoutes;
