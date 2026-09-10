package heartbeat

import (
	"context"
	"log/slog"
	"time"
)

// Run logs a heartbeat on the given interval until ctx is cancelled. This
// is the placeholder for real worker loops (queue consumers, processors)
// that will follow the same shape: respect ctx, return when told to.
func Run(ctx context.Context, logger *slog.Logger, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			logger.Info("heartbeat stopped")
			return
		case <-ticker.C:
			logger.Info("heartbeat")
		}
	}
}
