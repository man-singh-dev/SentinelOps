// Package logging builds the worker's structured logger on top of log/slog.
package logging

import (
	"fmt"
	"io"
	"log/slog"
)

// Supported output formats.
const (
	FormatJSON = "json"
	FormatText = "text"
)

// ParseLevel converts a textual level (debug, info, warn, error; case-insensitive)
// into a slog.Level.
func ParseLevel(s string) (slog.Level, error) {
	var level slog.Level
	if err := level.UnmarshalText([]byte(s)); err != nil {
		return 0, fmt.Errorf("unknown log level %q (want debug, info, warn or error)", s)
	}
	return level, nil
}

// New returns a logger writing to w at the given level. JSON is the default
// format because it is what log aggregators expect; text is for local development.
func New(w io.Writer, level slog.Level, format string) (*slog.Logger, error) {
	opts := &slog.HandlerOptions{Level: level}

	var h slog.Handler
	switch format {
	case FormatJSON, "":
		h = slog.NewJSONHandler(w, opts)
	case FormatText:
		h = slog.NewTextHandler(w, opts)
	default:
		return nil, fmt.Errorf("unknown log format %q (want %s or %s)", format, FormatJSON, FormatText)
	}

	return slog.New(h).With(slog.String("service", "worker")), nil
}
