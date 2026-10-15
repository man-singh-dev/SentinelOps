import { createHash, randomUUID } from "node:crypto";
import { describe, it, expect, afterEach, beforeAll, afterAll } from "vitest";
import { eq, like } from "drizzle-orm";
import { buildServer } from "../../app";
import { createDb, type DbConnection } from "../../db/client";
import { events, serviceApiKeys, services } from "../../db/schema";
import type { FastifyInstance } from "fastify";

describe("POST /api/v1/services", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it("returns 400 with issues when body is empty", async () => {
    app = buildServer();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/services",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ message: string; issues: unknown[] }>();
    expect(body.message).toBe("Validation failed");
    expect(body.issues).toBeDefined();
    expect(body.issues.length).toBeGreaterThan(0);
  });

  it("returns 400 when name is missing", async () => {
    app = buildServer();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/services",
      payload: { description: "No name supplied" },
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 400 when name exceeds 255 characters", async () => {
    app = buildServer();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/services",
      payload: { name: "x".repeat(256) },
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 400 when status is invalid", async () => {
    app = buildServer();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/services",
      payload: { name: "svc", status: "exploded" },
    });

    expect(response.statusCode).toBe(400);
  });
});

// PostgreSQL integration tests. Opt in with RUN_DB_TESTS=1 against a migrated
// database (DATABASE_URL); the CI api-checks job has no database.
describe.skipIf(process.env.RUN_DB_TESTS !== "1")(
  "POST /api/v1/services (PostgreSQL)",
  () => {
    let app: FastifyInstance;
    let conn: DbConnection;
    const runId = randomUUID();
    const namePrefix = `svc-test-${runId}`;

    type Registered = {
      service: { id: string; name: string; description: string | null; status: string };
      apiKey: { id: string; keyPrefix: string; key: string };
    };

    const register = (payload: Record<string, unknown>) =>
      app.inject({ method: "POST", url: "/api/v1/services", payload });

    const ingest = (apiKey: string, payload: Record<string, unknown>) =>
      app.inject({
        method: "POST",
        url: "/api/v1/events",
        headers: { "x-api-key": apiKey },
        payload,
      });

    beforeAll(async () => {
      conn = createDb();
      app = buildServer();
      await app.ready();
    });

    afterAll(async () => {
      await app?.close();
      if (conn) {
        // Cascades to service_api_keys and events.
        await conn.db.delete(services).where(like(services.name, `${namePrefix}%`));
        await conn.close();
      }
    });

    it("registers a service and returns a raw API key once, storing only its hash", async () => {
      const response = await register({
        name: `${namePrefix}-a`,
        description: "Handles payments",
        status: "degraded",
      });

      expect(response.statusCode).toBe(201);
      const body = response.json<Registered>();
      expect(body.service).toMatchObject({
        name: `${namePrefix}-a`,
        description: "Handles payments",
        status: "degraded",
      });
      expect(body.apiKey.key).toMatch(/^sk_[A-Za-z0-9_-]{43}$/);
      expect(body.apiKey.keyPrefix).toBe(body.apiKey.key.slice(0, 12));

      const [stored] = await conn.db
        .select()
        .from(serviceApiKeys)
        .where(eq(serviceApiKeys.serviceId, body.service.id));
      expect(stored.id).toBe(body.apiKey.id);
      expect(stored.keyHash).toBe(
        createHash("sha256").update(body.apiKey.key).digest("hex"),
      );
      expect(JSON.stringify(stored)).not.toContain(body.apiKey.key);
      expect(stored.isRevoked).toBe(false);
    });

    it("issues a different key for each service", async () => {
      const a = (await register({ name: `${namePrefix}-k1` })).json<Registered>();
      const b = (await register({ name: `${namePrefix}-k2` })).json<Registered>();

      expect(a.apiKey.key).not.toBe(b.apiKey.key);
    });

    it("returns 409 for a duplicate name and creates no extra service or key", async () => {
      const name = `${namePrefix}-dup`;
      const first = await register({ name });
      const second = await register({ name });

      expect(first.statusCode).toBe(201);
      expect(second.statusCode).toBe(409);
      expect(second.json()).toEqual({
        statusCode: 409,
        error: "Conflict",
        message: "A service with this name already exists",
      });
      const rows = await conn.db.select().from(services).where(eq(services.name, name));
      expect(rows).toHaveLength(1);
      const keys = await conn.db
        .select()
        .from(serviceApiKeys)
        .where(eq(serviceApiKeys.serviceId, rows[0].id));
      expect(keys).toHaveLength(1);
    });

    it("returns 400 and inserts nothing when ownerTeamId does not exist", async () => {
      const name = `${namePrefix}-noteam`;
      const response = await register({ name, ownerTeamId: randomUUID() });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        statusCode: 400,
        error: "Bad Request",
        message: "ownerTeamId does not reference an existing team",
      });
      expect(
        await conn.db.select().from(services).where(eq(services.name, name)),
      ).toHaveLength(0);
    });

    it("end to end: a registered key ingests events, dedupes, and survives concurrency", async () => {
      const registered = await register({ name: `${namePrefix}-e2e` });
      expect(registered.statusCode).toBe(201);
      const { service, apiKey } = registered.json<Registered>();

      const event = {
        eventId: `evt_e2e_${runId}`,
        eventType: "payment.failed",
        severity: "critical",
        timestamp: "2026-01-01T12:00:00Z",
      };
      const first = await ingest(apiKey.key, event);
      const again = await ingest(apiKey.key, event);
      expect(first.statusCode).toBe(201);
      expect(again.statusCode).toBe(200);
      expect(again.json()).toEqual({ eventId: event.eventId, duplicate: true });

      // Stage 2 gate: the same event_id sent concurrently stores one row.
      const concurrentId = `evt_e2e_concurrent_${runId}`;
      const responses = await Promise.all(
        Array.from({ length: 20 }, () =>
          ingest(apiKey.key, { ...event, eventId: concurrentId }),
        ),
      );
      const statuses = responses.map((r) => r.statusCode);
      expect(statuses.filter((s) => s === 201)).toHaveLength(1);
      expect(statuses.filter((s) => s === 200)).toHaveLength(19);

      const rows = await conn.db
        .select()
        .from(events)
        .where(eq(events.serviceId, service.id));
      expect(rows.map((r) => r.eventId).sort()).toEqual(
        [event.eventId, concurrentId].sort(),
      );
    });
  },
);
