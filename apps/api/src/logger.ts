import pino, { type Logger } from 'pino';

/**
 * A single logger factory used both before config is validated (boot
 * failures need to be logged too) and after (request logs at the
 * configured level). Pretty-printing is for local terminals only; in
 * production the raw JSON stream is left untouched for log aggregation.
 */
export function createLogger(level: string, pretty: boolean): Logger {
  return pino({
    level,
    transport: pretty
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
      : undefined,
  });
}
