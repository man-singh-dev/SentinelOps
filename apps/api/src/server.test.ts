import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { buildServer } from './server.js';
import type { Queryable } from './db.js';

const KNOWN_SERVICE = { id: '11111111-1111-1111-1111-111111111111', name: 'payment-service', created_at: '2026-01-01T00:00:00.000Z' };
const OTHER_SERVICE = { id: '22222222-2222-2222-2222-222222222222', name: 'auth-service', created_at: '2026-01-01T00:00:01.000Z' };

interface FakeEventRow {
  id: string;
  service_id: string;
  event_id: string;
  event_type: string;
  severity: string;
  message: string;
  metadata: Record<string, unknown>;
  occurred_at: string;
  received_at: string;
}

interface FakeServiceRow {
  id: string;
  name: string;
  created_at: string;
}

// In-memory stand-in for pg.Pool, scoped to exactly the queries the events
// routes issue. Keeps these tests fast and independent of a real Postgres
// instance - the migration itself (0002_create_events_table) is what
// guarantees the UNIQUE(service_id, event_id) constraint this fake
// re-implements for the duplicate-delivery test below, and the
// events_service_id_received_at_idx index the GET route's keyset query is
// shaped around.
class FakePool implements Queryable {
  private services: FakeServiceRow[] = [KNOWN_SERVICE, OTHER_SERVICE];
  private events: FakeEventRow[] = [];
  private nextEventNum = 1;
  private nextServiceNum = 1;

  async query<T extends pg.QueryResultRow = never>(
    text: string,
    params: unknown[] = [],
  ): Promise<pg.QueryResult<T>> {
    if (text.startsWith('SELECT id FROM services WHERE name')) {
      const [name] = params;
      const rows = this.services.filter((service) => service.name === name).map((s) => ({ id: s.id }));
      return { rows, rowCount: rows.length } as unknown as pg.QueryResult<T>;
    }

    if (text.startsWith('SELECT id FROM services WHERE id')) {
      const [id] = params;
      const rows = this.services.filter((service) => service.id === id).map((s) => ({ id: s.id }));
      return { rows, rowCount: rows.length } as unknown as pg.QueryResult<T>;
    }

    if (text.startsWith('INSERT INTO services')) {
      const [name] = params as [string];
      const isDuplicate = this.services.some((service) => service.name === name);
      if (isDuplicate) {
        // Mirrors what `pg` throws for a UNIQUE violation: an Error with
        // a `code` of '23505', the Postgres error code for
        // unique_violation - that's the only field the route inspects.
        const error = new Error('duplicate key value violates unique constraint') as Error & {
          code: string;
        };
        error.code = '23505';
        throw error;
      }

      const service = {
        id: `generated-service-${this.nextServiceNum++}`,
        name,
        created_at: new Date().toISOString(),
      };
      this.services.push(service);
      return { rows: [service], rowCount: 1 } as unknown as pg.QueryResult<T>;
    }

    if (text.startsWith('INSERT INTO events')) {
      const [serviceId, eventId] = params as [string, string];
      const isDuplicate = this.events.some(
        (event) => event.service_id === serviceId && event.event_id === eventId,
      );

      if (isDuplicate) {
        return { rows: [], rowCount: 0 } as unknown as pg.QueryResult<T>;
      }

      this.events.push({
        id: `generated-${this.nextEventNum++}`,
        service_id: serviceId,
        event_id: eventId,
        event_type: '',
        severity: 'info',
        message: '',
        metadata: {},
        occurred_at: new Date().toISOString(),
        received_at: new Date().toISOString(),
      });
      return { rows: [], rowCount: 1 } as unknown as pg.QueryResult<T>;
    }

    if (text.startsWith('SELECT id, service_id, event_id')) {
      // Params are always [service_id, severity, ...cursor?, limit] - the
      // route omits the cursor pair entirely on the first page, so 3
      // params means no cursor and 5 means a cursor was applied.
      const serviceId = params[0] as string | null;
      const severity = params[1] as string | null;
      const hasCursor = params.length === 5;
      const cursorReceivedAt = hasCursor ? (params[2] as string) : null;
      const cursorId = hasCursor ? (params[3] as string) : null;
      const limit = params[params.length - 1] as number;

      let rows = this.events.slice();
      if (serviceId !== null) {
        rows = rows.filter((event) => event.service_id === serviceId);
      }
      if (severity !== null) {
        rows = rows.filter((event) => event.severity === severity);
      }
      rows.sort((a, b) => {
        if (a.received_at !== b.received_at) {
          return a.received_at < b.received_at ? 1 : -1;
        }
        return a.id < b.id ? 1 : -1;
      });
      if (hasCursor) {
        rows = rows.filter((event) => {
          if (event.received_at !== cursorReceivedAt) {
            return event.received_at < (cursorReceivedAt as string);
          }
          return event.id < (cursorId as string);
        });
      }
      rows = rows.slice(0, limit);

      return { rows, rowCount: rows.length } as unknown as pg.QueryResult<T>;
    }

    if (text.startsWith('SELECT id, name, created_at')) {
      // Params are always [limit+1] on the first page (1 element) or
      // [createdAt, id, limit+1] when a cursor is applied (3 elements).
      const hasCursor = params.length === 3;
      const cursorCreatedAt = hasCursor ? (params[0] as string) : null;
      const cursorId = hasCursor ? (params[1] as string) : null;
      const limit = params[params.length - 1] as number;

      let rows = this.services.slice();
      rows.sort((a, b) => {
        if (a.created_at !== b.created_at) {
          return a.created_at < b.created_at ? 1 : -1;
        }
        return a.id < b.id ? 1 : -1;
      });
      if (hasCursor) {
        rows = rows.filter((service) => {
          if (service.created_at !== cursorCreatedAt) {
            return service.created_at < (cursorCreatedAt as string);
          }
          return service.id < (cursorId as string);
        });
      }
      rows = rows.slice(0, limit);

      return { rows, rowCount: rows.length } as unknown as pg.QueryResult<T>;
    }

    throw new Error(`FakePool received unexpected query: ${text}`);
  }

  get insertedCount(): number {
    return this.events.length;
  }

  // Test helper: seeds an event row directly, bypassing the POST route's
  // insert logic, so tests can control received_at/id ordering precisely
  // for pagination assertions.
  seedEvent(event: Partial<FakeEventRow> & { service_id: string }): void {
    this.events.push({
      id: event.id ?? `seed-${this.nextEventNum++}`,
      event_id: event.event_id ?? `evt-seed-${this.nextEventNum}`,
      event_type: event.event_type ?? 'test_event',
      severity: event.severity ?? 'info',
      message: event.message ?? 'seeded event',
      metadata: event.metadata ?? {},
      occurred_at: event.occurred_at ?? new Date().toISOString(),
      received_at: event.received_at ?? new Date().toISOString(),
      service_id: event.service_id,
    });
  }

  // Test helper: seeds a service row directly, bypassing the POST route's
  // insert logic, so tests can control created_at/id ordering precisely
  // for pagination assertions.
  seedService(service: Partial<FakeServiceRow> & { name: string }): void {
    this.services.push({
      id: service.id ?? `seed-service-${this.nextServiceNum++}`,
      name: service.name,
      created_at: service.created_at ?? new Date().toISOString(),
    });
  }
}

async function buildTestServer() {
  const pool = new FakePool();
  const app = await buildServer(
    { logLevel: 'silent', prettyLogs: false, corsOrigin: 'http://localhost:5173' },
    pool,
  );
  return { app, pool };
}

const validPayload = {
  event_id: 'evt-1',
  event_type: 'payment_failed',
  severity: 'error',
  message: 'card declined',
  occurred_at: '2026-01-01T00:00:00.000Z',
};

describe('POST /api/v1/events', () => {
  it('accepts a valid request', async () => {
    const { app } = await buildTestServer();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: { 'x-service-name': KNOWN_SERVICE.name },
      payload: validPayload,
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ status: 'accepted' });
  });

  it('rejects a request with no X-Service-Name header', async () => {
    const { app } = await buildTestServer();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      payload: validPayload,
    });

    expect(response.statusCode).toBe(401);
  });

  it('rejects a request with an unknown service name', async () => {
    const { app } = await buildTestServer();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: { 'x-service-name': 'no-such-service' },
      payload: validPayload,
    });

    expect(response.statusCode).toBe(401);
  });

  it('rejects a request missing a required field', async () => {
    const { app } = await buildTestServer();
    const withoutMessage: Record<string, unknown> = { ...validPayload };
    delete withoutMessage.message;

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: { 'x-service-name': KNOWN_SERVICE.name },
      payload: withoutMessage,
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects an invalid severity value', async () => {
    const { app } = await buildTestServer();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: { 'x-service-name': KNOWN_SERVICE.name },
      payload: { ...validPayload, severity: 'catastrophic' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('treats a duplicate (service_id, event_id) delivery as a no-op 202', async () => {
    const { app, pool } = await buildTestServer();

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: { 'x-service-name': KNOWN_SERVICE.name },
      payload: validPayload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: { 'x-service-name': KNOWN_SERVICE.name },
      payload: validPayload,
    });

    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);
    expect(pool.insertedCount).toBe(1);
  });

  it('rejects oversized metadata', async () => {
    const { app } = await buildTestServer();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: { 'x-service-name': KNOWN_SERVICE.name },
      payload: { ...validPayload, metadata: { blob: 'x'.repeat(10_000) } },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('POST /api/v1/services', () => {
  it('registers a new service and returns 201 with the created row', async () => {
    const { app } = await buildTestServer();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/services',
      payload: { name: 'notification-service' },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toMatchObject({ name: 'notification-service' });
    expect(body.id).toBeTruthy();
    expect(body.created_at).toBeTruthy();
  });

  it('rejects a duplicate name with 409, not 400', async () => {
    const { app } = await buildTestServer();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/services',
      payload: { name: KNOWN_SERVICE.name },
    });

    expect(response.statusCode).toBe(409);
  });

  it('rejects a request with no name', async () => {
    const { app } = await buildTestServer();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/services',
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects an empty string name', async () => {
    const { app } = await buildTestServer();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/services',
      payload: { name: '' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects an oversized name', async () => {
    const { app } = await buildTestServer();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/services',
      payload: { name: 'a'.repeat(256) },
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects a name containing whitespace', async () => {
    const { app } = await buildTestServer();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/services',
      payload: { name: 'payment service' },
    });

    expect(response.statusCode).toBe(400);
  });
});

// Spaced a second apart, oldest first, so tests can seed N events and know
// exactly which ones should come back in DESC order without relying on
// the id tiebreaker.
function timestampAt(index: number): string {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString();
}

describe('GET /api/v1/events', () => {
  it('returns the first page with no filters, capping at the default limit', async () => {
    const { app, pool } = await buildTestServer();
    for (let i = 0; i < 60; i++) {
      pool.seedEvent({ id: `evt-${i}`, service_id: KNOWN_SERVICE.id, received_at: timestampAt(i) });
    }

    const response = await app.inject({ method: 'GET', url: '/api/v1/events' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.events).toHaveLength(50);
    // DESC order: the newest seeded event (index 59) comes first.
    expect(body.events[0].id).toBe('evt-59');
    expect(body.next_cursor).not.toBeNull();
  });

  it('returns null next_cursor when there are fewer rows than the limit', async () => {
    const { app, pool } = await buildTestServer();
    pool.seedEvent({ id: 'evt-1', service_id: KNOWN_SERVICE.id, received_at: timestampAt(0) });
    pool.seedEvent({ id: 'evt-2', service_id: KNOWN_SERVICE.id, received_at: timestampAt(1) });

    const response = await app.inject({ method: 'GET', url: '/api/v1/events' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.events).toHaveLength(2);
    expect(body.next_cursor).toBeNull();
  });

  it('filters by service_id', async () => {
    const { app, pool } = await buildTestServer();
    pool.seedEvent({ id: 'evt-a', service_id: KNOWN_SERVICE.id, received_at: timestampAt(0) });
    pool.seedEvent({ id: 'evt-b', service_id: OTHER_SERVICE.id, received_at: timestampAt(1) });

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/events?service_id=${KNOWN_SERVICE.id}`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0].service_id).toBe(KNOWN_SERVICE.id);
  });

  it('filters by severity', async () => {
    const { app, pool } = await buildTestServer();
    pool.seedEvent({
      id: 'evt-error',
      service_id: KNOWN_SERVICE.id,
      severity: 'error',
      received_at: timestampAt(0),
    });
    pool.seedEvent({
      id: 'evt-info',
      service_id: KNOWN_SERVICE.id,
      severity: 'info',
      received_at: timestampAt(1),
    });

    const response = await app.inject({ method: 'GET', url: '/api/v1/events?severity=error' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0].severity).toBe('error');
  });

  it('rejects limit=0', async () => {
    const { app } = await buildTestServer();

    const response = await app.inject({ method: 'GET', url: '/api/v1/events?limit=0' });

    expect(response.statusCode).toBe(400);
  });

  it('rejects limit=101', async () => {
    const { app } = await buildTestServer();

    const response = await app.inject({ method: 'GET', url: '/api/v1/events?limit=101' });

    expect(response.statusCode).toBe(400);
  });

  it('rejects an unknown service_id with 400, not 404', async () => {
    const { app } = await buildTestServer();

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/events?service_id=99999999-9999-9999-9999-999999999999',
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects an invalid severity value', async () => {
    const { app } = await buildTestServer();

    const response = await app.inject({ method: 'GET', url: '/api/v1/events?severity=catastrophic' });

    expect(response.statusCode).toBe(400);
  });

  it('rejects a malformed cursor', async () => {
    const { app } = await buildTestServer();

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/events?cursor=not-valid-base64-content!!!',
    });

    expect(response.statusCode).toBe(400);
  });

  it('paginates via cursor with no overlap or skip between pages', async () => {
    const { app, pool } = await buildTestServer();
    for (let i = 0; i < 5; i++) {
      pool.seedEvent({ id: `evt-${i}`, service_id: KNOWN_SERVICE.id, received_at: timestampAt(i) });
    }

    const firstPage = await app.inject({ method: 'GET', url: '/api/v1/events?limit=2' });
    expect(firstPage.statusCode).toBe(200);
    const firstBody = firstPage.json();
    expect(firstBody.events.map((e: { id: string }) => e.id)).toEqual(['evt-4', 'evt-3']);
    expect(firstBody.next_cursor).not.toBeNull();

    const secondPage = await app.inject({
      method: 'GET',
      url: `/api/v1/events?limit=2&cursor=${encodeURIComponent(firstBody.next_cursor)}`,
    });
    expect(secondPage.statusCode).toBe(200);
    const secondBody = secondPage.json();
    expect(secondBody.events.map((e: { id: string }) => e.id)).toEqual(['evt-2', 'evt-1']);
    expect(secondBody.next_cursor).not.toBeNull();

    const thirdPage = await app.inject({
      method: 'GET',
      url: `/api/v1/events?limit=2&cursor=${encodeURIComponent(secondBody.next_cursor)}`,
    });
    expect(thirdPage.statusCode).toBe(200);
    const thirdBody = thirdPage.json();
    expect(thirdBody.events.map((e: { id: string }) => e.id)).toEqual(['evt-0']);
    expect(thirdBody.next_cursor).toBeNull();
  });
});

describe('GET /api/v1/services', () => {
  it('returns all services and null next_cursor when fewer rows than the limit', async () => {
    // The FakePool starts with KNOWN_SERVICE and OTHER_SERVICE (2 rows), well
    // below the default limit of 50, so next_cursor must be null.
    const { app } = await buildTestServer();

    const response = await app.inject({ method: 'GET', url: '/api/v1/services' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.services).toHaveLength(2);
    expect(body.next_cursor).toBeNull();
  });

  it('returns the first page and a next_cursor when more rows exist than the limit', async () => {
    const { app, pool } = await buildTestServer();
    // Seed 3 extra services; total pool = 5, which exceeds limit=4.
    for (let i = 0; i < 3; i++) {
      pool.seedService({ name: `extra-${i}`, created_at: timestampAt(i + 2) });
    }

    const response = await app.inject({ method: 'GET', url: '/api/v1/services?limit=4' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.services).toHaveLength(4);
    expect(body.next_cursor).not.toBeNull();
  });

  it('rejects limit=0 with 400', async () => {
    const { app } = await buildTestServer();

    const response = await app.inject({ method: 'GET', url: '/api/v1/services?limit=0' });

    expect(response.statusCode).toBe(400);
  });

  it('rejects limit=101 with 400', async () => {
    const { app } = await buildTestServer();

    const response = await app.inject({ method: 'GET', url: '/api/v1/services?limit=101' });

    expect(response.statusCode).toBe(400);
  });

  it('rejects a malformed cursor with 400', async () => {
    const { app } = await buildTestServer();

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/services?cursor=not-valid-base64-content!!!',
    });

    expect(response.statusCode).toBe(400);
  });

  it('paginates via cursor with no overlap or skip between pages', async () => {
    const { app, pool } = await buildTestServer();
    // Seed 5 services at timestampAt(2)–timestampAt(6), placing them ahead of
    // KNOWN_SERVICE (ts0) and OTHER_SERVICE (ts1) in DESC order. This gives a
    // fully deterministic 4-page sequence with limit=2:
    //   page 1: svc-4, svc-3
    //   page 2: svc-2, svc-1
    //   page 3: svc-0, OTHER_SERVICE
    //   page 4: KNOWN_SERVICE  (next_cursor null — last row)
    for (let i = 0; i < 5; i++) {
      pool.seedService({ id: `svc-${i}`, name: `service-${i}`, created_at: timestampAt(i + 2) });
    }

    const firstPage = await app.inject({ method: 'GET', url: '/api/v1/services?limit=2' });
    expect(firstPage.statusCode).toBe(200);
    const firstBody = firstPage.json();
    expect(firstBody.services.map((s: { id: string }) => s.id)).toEqual(['svc-4', 'svc-3']);
    expect(firstBody.next_cursor).not.toBeNull();

    const secondPage = await app.inject({
      method: 'GET',
      url: `/api/v1/services?limit=2&cursor=${encodeURIComponent(firstBody.next_cursor as string)}`,
    });
    expect(secondPage.statusCode).toBe(200);
    const secondBody = secondPage.json();
    expect(secondBody.services.map((s: { id: string }) => s.id)).toEqual(['svc-2', 'svc-1']);
    expect(secondBody.next_cursor).not.toBeNull();

    const thirdPage = await app.inject({
      method: 'GET',
      url: `/api/v1/services?limit=2&cursor=${encodeURIComponent(secondBody.next_cursor as string)}`,
    });
    expect(thirdPage.statusCode).toBe(200);
    const thirdBody = thirdPage.json();
    expect(thirdBody.services.map((s: { id: string }) => s.id)).toEqual([
      'svc-0',
      OTHER_SERVICE.id,
    ]);
    expect(thirdBody.next_cursor).not.toBeNull();

    const fourthPage = await app.inject({
      method: 'GET',
      url: `/api/v1/services?limit=2&cursor=${encodeURIComponent(thirdBody.next_cursor as string)}`,
    });
    expect(fourthPage.statusCode).toBe(200);
    const fourthBody = fourthPage.json();
    expect(fourthBody.services.map((s: { id: string }) => s.id)).toEqual([KNOWN_SERVICE.id]);
    expect(fourthBody.next_cursor).toBeNull();
  });
});
