import amqplib, { type Channel, type ChannelModel } from 'amqplib';
import type { Logger } from 'pino';
//RabbitMQ connection manager
//connectQueue() → connect API to RabbitMQ
//closeQueue() → disconnect API from RabbitMQ
let connection: ChannelModel | null = null;
let channel: Channel | null = null;
let _logger: Logger | null = null;

export async function connectQueue(url: string, logger: Logger): Promise<void> {
  connection = await amqplib.connect(url);
  _logger = logger;
  logger.info('rabbitmq connected');
  await declareTopology();
}

// Declares exchange, queue, and binding on every startup. Propagates on
// failure so index.ts's existing try/catch around connectQueue() handles it.
async function declareTopology(): Promise<void> {
  channel = await connection!.createChannel();
  await channel.assertExchange('events.exchange', 'direct', { durable: true });
  await channel.assertQueue('events.incoming', { durable: true });
  await channel.bindQueue('events.incoming', 'events.exchange', 'event');
  _logger?.info('rabbitmq topology declared');
}

// Publishes a validated event payload to the events exchange. Returns true if
// the broker accepted the message, false if the channel is not available.
// Throws if channel.publish() itself throws (e.g. channel is closed/blocked),
// so callers can distinguish "no channel" (false) from "publish error" (throw).
export function publishEvent(payload: Record<string, unknown>): boolean {
  if (!channel) {
    return false;
  }
  return channel.publish(
    'events.exchange',
    'event',
    Buffer.from(JSON.stringify(payload)),
    { persistent: true },
  );
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
      channel = null;
    }
  }
}
