package queue

import (
	"context"
	"log/slog"

	amqp "github.com/rabbitmq/amqp091-go"
)

// Run ranges over deliveries, logs each message, and acks it. It returns
// when ctx is cancelled or the delivery channel is closed (e.g. the broker
// dropped the connection). This follows the same shape as heartbeat.Run so
// main.go's wg.Add(1)/go func() pattern doesn't need to change.
func Run(ctx context.Context, logger *slog.Logger, deliveries <-chan amqp.Delivery) {
	for {
		select {
		case <-ctx.Done():
			logger.Info("consumer stopped")
			return
		case d, ok := <-deliveries:
			if !ok {
				// Broker closed the channel; return so the goroutine exits
				// cleanly and wg.Done() fires. The shutdown sequence closes
				// the connection after wg.Wait(), so this is the normal path
				// on a graceful stop.
				logger.Info("consumer channel closed")
				return
			}
			logger.Info("event received",
				"routing_key", d.RoutingKey,
				"body", string(d.Body),
			)
			d.Ack(false)
		}
	}
}
