import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { buildServer } from './server.js';
import type { Queryable } from './db.js';

const KNOWN_SERVICE = { id: '11111111-1111-1111-1111-111111111111', name: 'payment-service' };

// In-memory stand-in for pg.Pool, scoped to exactly the two queries the
// events route issues. Keeps these tests fast and independent of a real
// Postgres instance - the migration itself (0002_create_events_table) is
// what guarantees the UNIQUE(service_id, event_id) constraint this fake
// re-implements for the duplicate-delivery test below.
class FakePool implements Queryable {
  private events: Array<{ service_id: string; event_id: string }> = [];

  async query<T extends pg.QueryResultRow = never>(
    text: string,
    params: unknown[] = [],
  ): Promise<pg.QueryResult<T>> {
    if (text.startsWith('SELECT id FROM services')) {
      const [name] = params;
      const rows = name === KNOWN_SERVICE.name ? [{ id: KNOWN_SERVICE.id }] : [];
      return { rows, rowCount: rows.length } as unknown as pg.QueryResult<T>;
    }

    if (text.startsWith('INSERT INTO events')) {
      const [serviceId, eventId] = params as [string, string];
      const isDuplicate = this.events.some(
        (event) => event.service_id === serviceId && event.event_id === eventId,
      );

      if (isDuplicate) {
        return { rows: [], rowCount: 0 } as unknown as pg.QueryResult<T>;
      }

      this.events.push({ service_id: serviceId, event_id: eventId });
      return { rows: [], rowCount: 1 } as unknown as pg.QueryResult<T>;
    }

    throw new Error(`FakePool received unexpected query: ${text}`);
  }

  get insertedCount(): number {
    return this.events.length;
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
