import { createHash, randomUUID } from "node:crypto";
import { describe, it, expect, afterEach, beforeAll, afterAll } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { buildServer } from "../../app";
import { createDb, type DbConnection } from "../../db/client";
import { events, serviceApiKeys, services } from "../../db/schema";
import type { FastifyInstance } from "fastify";
const validPayload = {
  eventId: "evt_abc123",
  eventType: "payment.failed",
  severity: "critical",
  message: "Gateway timeout while charging card",
  timestamp: "2026-01-01T12:00:00Z",
  metadata: { region: "ap-south-1", gateway: "stripe" },
};

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

describe("POST /api/v1/events (no database required)", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it("returns 401 when X-API-Key is missing", async () => {
    app = buildServer();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      payload: validPayload,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      statusCode: 401,
      error: "Unauthorized",
      message: "Missing or invalid API key",
    });
  });

  it("returns 401 when X-API-Key is blank", async () => {
    app = buildServer();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: { "x-api-key": "   " },
      payload: validPayload,
    });

    expect(response.statusCode).toBe(401);
  });
});

// PostgreSQL integration tests. Opt in with RUN_DB_TESTS=1 against a migrated
// database (DATABASE_URL); the CI api-checks job has no database.
describe.skipIf(process.env.RUN_DB_TESTS !== "1")(
  "POST /api/v1/events (PostgreSQL)",
  () => {
    let app: FastifyInstance;
    let conn: DbConnection;
    const runId = randomUUID();
    const rawKey = `sk_test_${runId}`;
    const revokedRawKey = `sk_revoked_${runId}`;
    let serviceId: string;
    let otherServiceId: string;

    const post = (payload: unknown, apiKey: string | undefined = rawKey) =>
      app.inject({
        method: "POST",
        url: "/api/v1/events",
        headers: apiKey === undefined ? {} : { "x-api-key": apiKey },
        payload: payload as Record<string, unknown>,
      });

    const findEvents = (eventId: string) =>
      conn.db.select().from(events).where(eq(events.eventId, eventId));

    beforeAll(async () => {
      conn = createDb();
      const [svc, other] = await conn.db
        .insert(services)
        .values([
          { name: `chunk4-test-${runId}` },
          { name: `chunk4-test-other-${runId}` },
        ])
        .returning({ id: services.id });
      serviceId = svc.id;
      otherServiceId = other.id;
      await conn.db.insert(serviceApiKeys).values([
        {
          serviceId,
          name: "test",
          keyHash: sha256(rawKey),
          keyPrefix: rawKey.slice(0, 12),
        },
        {
          serviceId,
          name: "revoked",
          keyHash: sha256(revokedRawKey),
          keyPrefix: revokedRawKey.slice(0, 12),
          isRevoked: true,
          revokedAt: new Date(),
        },
      ]);
      app = buildServer();
      await app.ready();
    });

    afterAll(async () => {
      await app?.close();
      if (conn) {
        // Cascades to service_api_keys and events.
        if (serviceId) {
          await conn.db
            .delete(services)
            .where(inArray(services.id, [serviceId, otherServiceId]));
        }
        await conn.close();
      }
    });

    it("ingests a valid event and returns 201", async () => {
      const eventId = `evt_ok_${runId}`;
      const response = await post({ ...validPayload, eventId });

      expect(response.statusCode).toBe(201);
      const body = response.json<{ id: string; eventId: string; duplicate: boolean }>();
      expect(body.eventId).toBe(eventId);
      expect(body.duplicate).toBe(false);

      const rows = await findEvents(eventId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: body.id,
        serviceId,
        eventType: validPayload.eventType,
        severity: "critical",
        message: validPayload.message,
        metadata: validPayload.metadata,
        occurredAt: new Date(validPayload.timestamp),
      });
    });

    it("returns 401 for an unknown API key", async () => {
      const eventId = `evt_badkey_${runId}`;
      const response = await post({ ...validPayload, eventId }, "sk_does_not_exist");

      expect(response.statusCode).toBe(401);
      expect(await findEvents(eventId)).toHaveLength(0);
    });

    it("returns 401 for a revoked API key", async () => {
      const eventId = `evt_revoked_${runId}`;
      const response = await post({ ...validPayload, eventId }, revokedRawKey);

      expect(response.statusCode).toBe(401);
      expect(await findEvents(eventId)).toHaveLength(0);
    });

    it("returns 400 with issues for an invalid payload", async () => {
      const response = await post({ ...validPayload, severity: "urgent" });

      expect(response.statusCode).toBe(400);
      const body = response.json<{ message: string; issues: unknown[] }>();
      expect(body.message).toBe("Validation failed");
      expect(body.issues.length).toBeGreaterThan(0);
    });

    it("returns 400 when serviceId is not a UUID", async () => {
      const response = await post({ ...validPayload, serviceId: "not-a-uuid" });

      expect(response.statusCode).toBe(400);
    });

    it("accepts a payload serviceId matching the authenticated service", async () => {
      const eventId = `evt_match_${runId}`;
      const response = await post({
        ...validPayload,
        eventId,
        serviceId: serviceId.toUpperCase(),
      });

      expect(response.statusCode).toBe(201);
      const rows = await findEvents(eventId);
      expect(rows).toHaveLength(1);
      expect(rows[0].serviceId).toBe(serviceId);
    });

    it("returns 403 and inserts nothing when payload serviceId mismatches", async () => {
      const eventId = `evt_mismatch_${runId}`;
      const response = await post({
        ...validPayload,
        eventId,
        serviceId: otherServiceId,
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({
        statusCode: 403,
        error: "Forbidden",
        message:
          "The supplied service ID does not match the authenticated service. Please verify your service ID.",
      });
      const stored = await conn.db
        .select()
        .from(events)
        .where(
          and(
            eq(events.eventId, eventId),
            inArray(events.serviceId, [serviceId, otherServiceId]),
          ),
        );
      expect(stored).toHaveLength(0);
    });

    it("generates the fingerprint server-side and ignores a client-supplied one", async () => {
      const eventId = `evt_fp_${runId}`;
      const response = await post({
        ...validPayload,
        eventId,
        fingerprint: "client-supplied",
      });

      expect(response.statusCode).toBe(201);
      const [row] = await findEvents(eventId);
      expect(row.fingerprint).toBe(sha256(`${serviceId}\n${validPayload.eventType}`));
      expect(row.fingerprint).not.toBe("client-supplied");
    });

    it("returns 200 duplicate for a repeated eventId and keeps one row", async () => {
      const eventId = `evt_dup_${runId}`;
      const first = await post({ ...validPayload, eventId });
      const second = await post({ ...validPayload, eventId, message: "retry" });

      expect(first.statusCode).toBe(201);
      expect(second.statusCode).toBe(200);
      expect(second.json()).toEqual({ eventId, duplicate: true });
      const rows = await findEvents(eventId);
      expect(rows).toHaveLength(1);
      expect(rows[0].message).toBe(validPayload.message);
    });

    it("stores exactly one row under concurrent duplicate requests", async () => {
      const eventId = `evt_concurrent_${runId}`;
      const responses = await Promise.all(
        Array.from({ length: 10 }, () => post({ ...validPayload, eventId })),
      );

      const statuses = responses.map((r) => r.statusCode).sort();
      expect(statuses.filter((s) => s === 201)).toHaveLength(1);
      expect(statuses.filter((s) => s === 200)).toHaveLength(9);
      expect(await findEvents(eventId)).toHaveLength(1);
    });

    it("returns a sanitized 500 when PostgreSQL rejects the insert", async () => {
      // PostgreSQL jsonb cannot store \u0000, so this is a real database error.
      const eventId = `evt_dberr_${runId}`;
      const response = await post({
        ...validPayload,
        eventId,
        metadata: { bad: "\u0000" },
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({
        statusCode: 500,
        error: "Internal Server Error",
        message: "Internal Server Error",
      });
      expect(response.body).not.toMatch(/unicode|jsonb|insert|events/i);
      expect(await findEvents(eventId)).toHaveLength(0);
    });
  },
);
