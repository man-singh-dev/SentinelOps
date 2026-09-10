import Fastify, { type FastifyInstance } from 'fastify';
import type pg from 'pg';

interface ServerOptions {
  logLevel: string;
  prettyLogs: boolean;
}

export function buildServer(options: ServerOptions, pool: pg.Pool): FastifyInstance {
  const app = Fastify({
    logger: {
      level: options.logLevel,
      transport: options.prettyLogs
        ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
        : undefined,
    },
  });

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

  return app;
}
