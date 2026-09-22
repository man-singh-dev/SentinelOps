import amqplib, { type ChannelModel } from 'amqplib';
import type { Logger } from 'pino';
//RabbitMQ connection manager
//connectQueue() → connect API to RabbitMQ
//closeQueue() → disconnect API from RabbitMQ
let connection: ChannelModel | null = null;
let _logger: Logger | null = null;

export async function connectQueue(url: string, logger: Logger): Promise<void> {
  connection = await amqplib.connect(url);
  _logger = logger;
  logger.info('rabbitmq connected');
}

// Closes the AMQP connection if one is open. Called from the graceful-shutdown
// handler in index.ts alongside app.close() and pool.end().
export async function closeQueue(): Promise<void> {
  if (connection) {
    try {
      await connection.close();
    } catch (err) {
      _logger?.warn({ err }, 'rabbitmq connection close failed – already dead?');
    } finally {
      connection = null;
    }
  }
}
