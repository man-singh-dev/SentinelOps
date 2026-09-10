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
	"github.com/man-singh-dev/SentinelOps/apps/worker/internal/heartbeat"
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

	// Every long-running loop registers here before it starts and calls
	// Done when it returns. There's only the heartbeat today; a queue
	// consumer added later follows the identical wg.Add(1)/go func(){...}
	// pattern, so shutdown draining doesn't need to change shape.
	var wg sync.WaitGroup

	wg.Add(1)
	go func() {
		defer wg.Done()
		heartbeat.Run(ctx, logger, heartbeatInterval)
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
