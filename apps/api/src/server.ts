import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import type { Queryable } from './db.js';

interface ServerOptions {
  logLevel: string;
  prettyLogs: boolean;
  corsOrigin: string;
}

const SEVERITIES = ['debug', 'info', 'warning', 'error', 'critical'] as const;

const eventBodySchema = z.object({
  event_id: z.string().min(1).max(255),
  event_type: z.string().min(1).max(255),
  severity: z.enum(SEVERITIES),
  message: z.string().min(1).max(2000),
  occurred_at: z.string().datetime(),
  // metadata's shape is intentionally open - each service attaches
  // whatever structured context makes sense for it - but the size must
  // stay bounded so one oversized payload can't bloat storage or block
  // the request. 10,000 chars of serialized JSON is a generous ceiling
  // for per-event context without being unbounded.
  metadata: z
    .record(z.unknown())
    .default({})
    .refine((value) => JSON.stringify(value).length <= 10_000, {
      message: 'metadata must serialize to 10,000 characters or fewer',
    }),
});

interface ServiceRow {
  id: string;
}

interface EventRow {
  id: string;
  service_id: string;
  event_id: string;
  event_type: string;
  severity: (typeof SEVERITIES)[number];
  message: string;
  metadata: Record<string, unknown>;
  occurred_at: string | Date;
  received_at: string | Date;
}

const eventsQuerySchema = z.object({
  service_id: z.string().uuid().optional(),
  severity: z.enum(SEVERITIES).optional(),
  // Bounded rather than clamped: a limit outside [1, 100] almost always
  // means the caller has a bug (an off-by-one, a config value that leaked
  // in unvalidated, etc). Silently clamping it to the nearest valid value
  // would hide that bug behind a response that "looks fine" - same
  // fail-fast reasoning as env validation in config.ts. An explicit 400
  // surfaces the bug at the call site instead of downstream.
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
});

// Cursor is "<received_at ISO>_<id>", base64-encoded. Neither an ISO
// timestamp nor a UUID can contain "_", so a single split is unambiguous.
function decodeCursor(cursor: string): { receivedAt: string; id: string } | null {
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, 'base64').toString('utf8');
  } catch {
    return null;
  }

  const separatorIndex = decoded.indexOf('_');
  if (separatorIndex <= 0 || separatorIndex === decoded.length - 1) {
    return null;
  }

  const receivedAt = decoded.slice(0, separatorIndex);
  const id = decoded.slice(separatorIndex + 1);

  if (Number.isNaN(Date.parse(receivedAt))) {
    return null;
  }

  return { receivedAt, id };
}

function encodeCursor(receivedAt: string | Date, id: string): string {
  const iso = receivedAt instanceof Date ? receivedAt.toISOString() : receivedAt;
  return Buffer.from(`${iso}_${id}`).toString('base64');
}

export async function buildServer(options: ServerOptions, pool: Queryable): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: options.logLevel,
      transport: options.prettyLogs
        ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
        : undefined,
    },
  });

  await app.register(cors, { origin: options.corsOrigin });

  // Liveness: is the process alive and able to respond at all. Touches no
  // dependencies - Postgres being down is not a reason to restart the API;
  // restarting it wouldn't fix the database and would just cause a
  // crash-loop on top of an already-degraded system.
  app.get('/healthz', async () => {
    return { status: 'ok' };
  });

  // Readiness: can this instance correctly serve traffic right now. A
  // failed check here means "stop routing to me", not "kill me" - so it's
  // a 503, not a crash.
  app.get('/readyz', async (request, reply) => {
    try {
      await pool.query('SELECT 1');
      return { status: 'ok' };
    } catch (err) {
      request.log.error({ err }, 'readiness check failed: database unreachable');
      return reply.status(503).send({ status: 'unavailable' });
    }
  });

  // No authentication exists yet (deferred to Phase 7 by design). Until
  // then, the sending service identifies itself with this header, which
  // is resolved to a service_id via a lookup in the services table.
  // Structured as a distinct identification step up front so Phase 7 can
  // swap it for verified API key authentication without touching anything
  // past this point - only how service_id is obtained changes.
  app.post('/api/v1/events', async (request, reply) => {
    const serviceName = request.headers['x-service-name'];

    if (typeof serviceName !== 'string' || serviceName.length === 0) {
      request.log.info('event rejected: missing X-Service-Name header');
      return reply.status(401).send({ error: 'missing X-Service-Name header' });
    }

    const serviceResult = await pool.query<ServiceRow>('SELECT id FROM services WHERE name = $1', [
      serviceName,
    ]);
    const service = serviceResult.rows[0];

    if (!service) {
      request.log.info({ service_name: serviceName }, 'event rejected: unknown service');
      return reply.status(401).send({ error: `unknown service: ${serviceName}` });
    }

    const parseResult = eventBodySchema.safeParse(request.body);
    if (!parseResult.success) {
      request.log.info(
        { service_id: service.id },
        'event rejected: invalid request body',
      );
      return reply.status(400).send({ error: parseResult.error.issues });
    }

    const event = parseResult.data;

    // ON CONFLICT DO NOTHING, not DO UPDATE: (service_id, event_id) is the
    // idempotency key, and a retried delivery of the same event must be a
    // true no-op - the first delivery's row is what's kept, and the
    // caller can't tell a retry apart from a first delivery from the
    // response either way (both get 202 below).
    const insertResult = await pool.query(
      `INSERT INTO events (service_id, event_id, event_type, severity, message, metadata, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (service_id, event_id) DO NOTHING`,
      [
        service.id,
        event.event_id,
        event.event_type,
        event.severity,
        event.message,
        event.metadata,
        event.occurred_at,
      ],
    );

    const outcome = insertResult.rowCount === 0 ? 'duplicate-ignored' : 'accepted';
    // Never log metadata or message - both may carry sensitive data from
    // the sending service.
    request.log.info({ service_id: service.id, event_id: event.event_id, outcome }, 'event ingested');

    // 202, not 201, for both branches above: this endpoint's contract is
    // "durably accepted," not "fully processed," and the caller shouldn't
    // be able to distinguish a retry from a first delivery. Phase 2 will
    // move the actual write behind a queue, and that shift shouldn't
    // require this response code to change.
    return reply.status(202).send({ status: 'accepted' });
  });

  app.get('/api/v1/events', async (request, reply) => {
    const parseResult = eventsQuerySchema.safeParse(request.query);
    if (!parseResult.success) {
      return reply.status(400).send({ error: parseResult.error.issues });
    }

    const { service_id: serviceId, severity, limit, cursor } = parseResult.data;

    let cursorValues: { receivedAt: string; id: string } | null = null;
    if (cursor !== undefined) {
      cursorValues = decodeCursor(cursor);
      if (!cursorValues) {
        return reply.status(400).send({ error: 'malformed cursor' });
      }
    }

    if (serviceId !== undefined) {
      const serviceResult = await pool.query<ServiceRow>('SELECT id FROM services WHERE id = $1', [
        serviceId,
      ]);
      if (!serviceResult.rows[0]) {
        // 400, not 404: service_id here is a filter parameter the caller
        // chose, not a resource being addressed by path - an unknown
        // value is a bad request, the same as an invalid severity.
        return reply.status(400).send({ error: `unknown service_id: ${serviceId}` });
      }
    }

    const params: unknown[] = [serviceId ?? null, severity ?? null];

    // Omit the keyset condition entirely on the first page rather than
    // passing sentinel values for $3/$4 - there's no "smallest possible"
    // (received_at, id) pair to sentinel against, and building the clause
    // conditionally keeps the query planner's job simple (no OR branch to
    // reason about for the common first-page case).
    let cursorClause = '';
    if (cursorValues) {
      cursorClause = `AND (received_at, id) < ($${params.length + 1}, $${params.length + 2})`;
      params.push(cursorValues.receivedAt, cursorValues.id);
    }

    // Fetch one row past the page size so "is there a next page" is
    // answered from data already in hand, instead of a separate COUNT(*)
    // query against the same table.
    const limitParamIndex = params.length + 1;
    params.push(limit + 1);

    let result;
    try {
      // Keyset pagination on (received_at, id), not OFFSET: OFFSET has to
      // walk and discard every skipped row, so cost grows linearly with
      // page depth on a high-volume append-only table like this one.
      // OFFSET also isn't safe under concurrent inserts - rows can shift
      // position between requests, causing skipped or duplicated results
      // across pages. Comparing the indexed (service_id, received_at)
      // pair against a cursor is constant-cost per page and stable
      // regardless of concurrent writes; id is included as a tiebreaker
      // since received_at alone isn't guaranteed unique.
      result = await pool.query<EventRow>(
        `SELECT id, service_id, event_id, event_type, severity, message,
                metadata, occurred_at, received_at
         FROM events
         WHERE (service_id = $1::uuid OR $1 IS NULL)
           AND (severity = $2::severity OR $2 IS NULL)
           ${cursorClause}
         ORDER BY received_at DESC, id DESC
         LIMIT $${limitParamIndex}`,
        params,
      );
    } catch (err) {
      request.log.error({ err }, 'failed to query events');
      return reply.status(500).send({ error: 'internal server error' });
    }

    const hasNextPage = result.rows.length > limit;
    const page = hasNextPage ? result.rows.slice(0, limit) : result.rows;
    const lastRow = page[page.length - 1];
    const nextCursor = hasNextPage && lastRow ? encodeCursor(lastRow.received_at, lastRow.id) : null;

    return reply.status(200).send({ events: page, next_cursor: nextCursor });
  });

  return app;
}
