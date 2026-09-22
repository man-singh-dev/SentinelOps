package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/man-singh-dev/SentinelOps/apps/worker/internal/config"
	"github.com/man-singh-dev/SentinelOps/apps/worker/internal/db"
	"github.com/man-singh-dev/SentinelOps/apps/worker/internal/heartbeat"
	"github.com/man-singh-dev/SentinelOps/apps/worker/internal/queue"
)

const (
	shutdownTimeout   = 10 * time.Second
	heartbeatInterval = 5 * time.Second
)

func main() {
	bootLogger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	cfg, err := config.Load()
	if err != nil {
		bootLogger.Error("invalid configuration, refusing to start", "error", err)
		os.Exit(1)
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: parseLevel(cfg.LogLevel),
	}))

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// Connect to PostgreSQL; fail fast if the DSN is wrong or the server is
	// unreachable — a worker that can't reach its data store is useless.
	pool, err := db.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		logger.Error("failed to connect to postgres", "error", err)
		os.Exit(1)
	}
	logger.Info("postgres connected")

	// Connect to RabbitMQ for the same reason.
	amqpConn, err := queue.Open(cfg.RabbitMQURL)
	if err != nil {
		logger.Error("failed to connect to rabbitmq", "error", err)
		os.Exit(1)
	}
	logger.Info("rabbitmq connected")

	// Every long-running loop registers here before it starts and calls
	// Done when it returns. New goroutines follow the identical
	// wg.Add(1)/go func(){...} pattern so shutdown draining never needs
	// to change shape.
	var wg sync.WaitGroup

	// Open the consumer before starting goroutines; fail fast if the queue
	// is unreachable so we don't spin up a half-wired worker.
	deliveries, err := queue.Consume(amqpConn)
	if err != nil {
		logger.Error("failed to start consumer", "error", err)
		os.Exit(1)
	}
	logger.Info("consumer started", "queue", "events.incoming")

	wg.Add(1)
	go func() {
		defer wg.Done()
		heartbeat.Run(ctx, logger, heartbeatInterval)
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		queue.Run(ctx, logger, deliveries)
	}()

	<-ctx.Done()
	logger.Info("shutdown signal received, draining...")

	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()

	select {
	case <-done:
		logger.Info("shutdown complete")
		// Close connections in reverse-open order, after all goroutines
		// have drained, so no in-flight work races with teardown.
		logger.Info("closing rabbitmq connection")
		queue.Close(amqpConn)
		logger.Info("closing postgres pool")
		db.Close(pool)
	case <-time.After(shutdownTimeout):
		logger.Warn("shutdown timed out, forcing exit")
		os.Exit(1)
	}
}

func parseLevel(level string) slog.Level {
	switch level {
	case "debug":
		return slog.LevelDebug
	case "warn":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}
