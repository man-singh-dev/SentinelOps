package queue

import (
	"fmt"

	amqp "github.com/rabbitmq/amqp091-go"
)

const (
	// queueName is the durable queue declared by the API. The worker asserts
	// it on startup so declaration order relative to the API doesn't matter.
	queueName   = "events.incoming"
	consumerTag = "worker"
)

// Open dials and returns an AMQP connection using the given URL. The caller
// owns the connection and must call Close when done.
func Open(url string) (*amqp.Connection, error) {
	conn, err := amqp.Dial(url)
	if err != nil {
		return nil, fmt.Errorf("amqp.Dial: %w", err)
	}
	return conn, nil
}

// Close closes the AMQP connection. Safe to call on a nil or already-closed
// connection.
func Close(conn *amqp.Connection) {
	if conn != nil && !conn.IsClosed() {
		conn.Close()
	}
}

// Consume opens a channel on conn, asserts the events.incoming queue (durable,
// matching the API's declaration), and returns a delivery channel for that
// queue with manual acknowledgement. The caller must not close the returned
// channel; it is closed automatically when the AMQP channel or connection
// drops.
func Consume(conn *amqp.Connection) (<-chan amqp.Delivery, error) { //conn naam ka RabbitMQ connection lo, aur mujhe ya to deliveries ka channel do, ya error do
	ch, err := conn.Channel()
	if err != nil {
		return nil, fmt.Errorf("amqp channel open: %w", err)
	}

	// Assert — not redeclare — so we verify the queue exists with the right
	// attributes without overwriting it if the API already created it.
	_, err = ch.QueueDeclare(
		queueName,
		true,  // durable
		false, // autoDelete
		false, // exclusive
		false, // noWait
		nil,   // args
	)
	if err != nil {
		ch.Close()
		return nil, fmt.Errorf("queue assert %q: %w", queueName, err)
	}

	deliveries, err := ch.Consume(
		queueName,
		consumerTag,
		false, // autoAck — we ack manually after processing
		false, // exclusive
		false, // noLocal
		false, // noWait
		nil,   // args
	)
	if err != nil {
		ch.Close()
		return nil, fmt.Errorf("amqp consume %q: %w", queueName, err)
	}

	return deliveries, nil
}
