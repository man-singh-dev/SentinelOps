package queue

import (
	"fmt"

	amqp "github.com/rabbitmq/amqp091-go"
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
