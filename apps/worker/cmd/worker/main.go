package main

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/man-singh-dev/SentinelOps/apps/worker/internal/app"
	"github.com/man-singh-dev/SentinelOps/apps/worker/internal/config"
	"github.com/man-singh-dev/SentinelOps/apps/worker/internal/logging"
)

// Process exit codes.
const (
	exitOK     = 0
	exitFailed = 1 // runtime or startup failure
	exitConfig = 2 // invalid configuration
)

func main() {
	os.Exit(run())
}

// run is separate from main so deferred cleanup runs before os.Exit.
func run() int {
	// Config decides the log level/format, so errors while loading it are
	// reported through a plain default logger.
	bootstrap, err := logging.New(os.Stdout, slog.LevelInfo, logging.FormatJSON)
	if err != nil {
		// Unreachable with constant arguments; kept so no error is ever dropped.
		os.Stderr.WriteString("failed to create bootstrap logger: " + err.Error() + "\n")
		return exitFailed
	}

	cfg, err := config.Load()
	if err != nil {
		var verr *config.ValidationError
		if errors.As(err, &verr) {
			bootstrap.Error("invalid configuration", slog.Any("problems", verr.Problems))
		} else {
			bootstrap.Error("failed to load configuration", slog.Any("error", err))
		}
		return exitConfig
	}
	//ab configuration successfully load ho chuki hai
	log, err := logging.New(os.Stdout, cfg.LogLevel, cfg.LogFormat)
	if err != nil {
		bootstrap.Error("failed to create logger", slog.Any("error", err))
		return exitConfig
	}

	log.Info("worker configured", slog.Any("config", cfg))
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// After the first signal, restore default signal behaviour so a second
	// Ctrl+C force-quits if graceful shutdown hangs.
	go func() {
		<-ctx.Done()
		stop()
	}()

	// RabbitMQ consumers and event-processing components get registered here later.
	w := app.New(log, cfg.ShutdownTimeout)

	if err := w.Run(ctx); err != nil {
		log.Error("worker exited with error", slog.Any("error", err))
		return exitFailed
	}

	log.Info("worker stopped cleanly")
	return exitOK
}
