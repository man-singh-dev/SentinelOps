import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createPool } from './db.js';
import { buildServer } from './server.js';

const isProd = process.env.NODE_ENV === 'production';
const bootLogger = createLogger('info', !isProd);

let config;
try {
  config = loadConfig();
} catch (err) {
  bootLogger.fatal({ err }, 'invalid configuration, refusing to start');
  process.exit(1);
}

const pool = createPool(config.DATABASE_URL);
const app = await buildServer(
  {
    logLevel: config.LOG_LEVEL,
    prettyLogs: config.NODE_ENV !== 'production',
    corsOrigin: config.CORS_ORIGIN,
  },
  pool,
);

app.listen({ port: config.API_PORT, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    app.log.fatal({ err }, 'failed to start server');
    process.exit(1);
  }
  app.log.info({ address }, 'api listening');
});
