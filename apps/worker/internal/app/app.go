package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"
)

var ErrShutdownTimeout = errors.New("shutdown timed out")

type Component interface {
	Name() string
	Run(ctx context.Context) error
}
type App struct {
	log             *slog.Logger
	shutdownTimeout time.Duration
	components      []Component
}

func New(log *slog.Logger, shutdownTimeout time.Duration, components ...Component) *App {
	return &App{
		log:             log,
		shutdownTimeout: shutdownTimeout,
		components:      components,
	}
}
func (a *App) Run(ctx context.Context) error {
	runCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	if len(a.components) == 0 {
		a.log.Info("no components registered; idling until shutdown signal")
		<-runCtx.Done()
		a.log.Info("shutdown signal received; exiting")
		return nil
	}

	errCh := make(chan error, len(a.components))
	var wg sync.WaitGroup

	for _, c := range a.components {
		wg.Add(1)
		go func() {
			defer wg.Done()
			a.log.Info("component starting", slog.String("component", c.Name()))

			err := c.Run(runCtx)
			if err != nil && !errors.Is(err, context.Canceled) {
				a.log.Error("component failed",
					slog.String("component", c.Name()), slog.Any("error", err))
				errCh <- fmt.Errorf("component %s: %w", c.Name(), err)
				cancel()
				return
			}
			a.log.Info("component stopped", slog.String("component", c.Name()))
		}()
	}

	allDone := make(chan struct{})
	go func() {
		wg.Wait()
		close(allDone)
	}()
	select {
	case <-runCtx.Done():
		a.log.Info("shutting down", slog.Duration("timeout", a.shutdownTimeout))
	case <-allDone:
	}
	cancel()

	timer := time.NewTimer(a.shutdownTimeout)
	defer timer.Stop()

	select {
	case <-allDone:
		a.log.Info("all components stopped")
		return drain(errCh)
	case <-timer.C:
		a.log.Error("components did not stop in time", slog.Duration("timeout", a.shutdownTimeout))
		return errors.Join(drain(errCh), ErrShutdownTimeout)
	}
}

func drain(errCh chan error) error {
	var errs []error
	for {
		select {
		case err := <-errCh:
			errs = append(errs, err)
		default:
			return errors.Join(errs...)
		}
	}
}
