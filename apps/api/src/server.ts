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

  return app;
}
