package config

import (
	"fmt"
	"os"
)

type Config struct {
	LogLevel string
}

// Load reads and validates environment variables, returning an error that
// lists every problem at once. The caller logs the error and exits - the
// worker must never run half-configured.
func Load() (Config, error) {
	level := os.Getenv("WORKER_LOG_LEVEL")

	var errs []string
	if level == "" {
		errs = append(errs, "WORKER_LOG_LEVEL is required")
	} else if !validLogLevel(level) {
		errs = append(errs, fmt.Sprintf("WORKER_LOG_LEVEL %q is not one of debug, info, warn, error", level))
	}

	if len(errs) > 0 {
		msg := "invalid environment configuration:"
		for _, e := range errs {
			msg += "\n  - " + e
		}
		return Config{}, fmt.Errorf("%s", msg)
	}

	return Config{LogLevel: level}, nil
}

func validLogLevel(level string) bool {
	switch level {
	case "debug", "info", "warn", "error":
		return true
	default:
		return false
	}
}
