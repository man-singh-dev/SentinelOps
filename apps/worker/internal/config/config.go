package config

import (
	"log/slog"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/man-singh-dev/SentinelOps/apps/worker/internal/logging"
)

const (
	EnvDatabaseURL      = "DATABASE_URL"
	EnvRabbitMQURL      = "RABBITMQ_URL"
	EnvConcurrency      = "WORKER_CONCURRENCY"
	EnvPrefetch         = "WORKER_PREFETCH"
	EnvShutdownTimeout  = "SHUTDOWN_TIMEOUT_SECONDS"
	EnvLogLevel         = "LOG_LEVEL"
	EnvLogFormat        = "LOG_FORMAT"
	maxConcurrency      = 1024
	maxPrefetch         = 65535
	defaultConcurrency  = 4
	defaultPrefetch     = 10
	defaultShutdownSecs = 30
)

type Config struct {
	DatabaseURL       string
	RabbitMQURL       string
	WorkerConcurrency int
	WorkerPrefetch    int
	ShutdownTimeout   time.Duration
	LogLevel          slog.Level
	LogFormat         string
}
type LookupFunc func(key string) (string, bool)
type ValidationError struct {
	Problems []string
}

func (e *ValidationError) Error() string {
	return "invalid configuration: " + strings.Join(e.Problems, "; ")
}
func Load() (Config, error) {
	return LoadFrom(os.LookupEnv)
}
func LoadFrom(lookup LookupFunc) (Config, error) {
	l := &loader{lookup: lookup}

	cfg := Config{
		DatabaseURL:       l.requiredURL(EnvDatabaseURL, "postgres", "postgresql"),
		RabbitMQURL:       l.requiredURL(EnvRabbitMQURL, "amqp", "amqps"),
		WorkerConcurrency: l.intInRange(EnvConcurrency, defaultConcurrency, 1, maxConcurrency),
		WorkerPrefetch:    l.intInRange(EnvPrefetch, defaultPrefetch, 1, maxPrefetch),
		ShutdownTimeout: time.Duration(
			l.intInRange(EnvShutdownTimeout, defaultShutdownSecs, 1, 3600),
		) * time.Second,
		LogLevel:  l.logLevel(),
		LogFormat: l.logFormat(),
	}

	if len(l.problems) > 0 {
		return Config{}, &ValidationError{Problems: l.problems}
	}
	return cfg, nil
}
func (c Config) LogValue() slog.Value {
	return slog.GroupValue(
		slog.String("database_url", redactURL(c.DatabaseURL)),
		slog.String("rabbitmq_url", redactURL(c.RabbitMQURL)),
		slog.Int("worker_concurrency", c.WorkerConcurrency),
		slog.Int("worker_prefetch", c.WorkerPrefetch),
		slog.Duration("shutdown_timeout", c.ShutdownTimeout),
		slog.String("log_level", c.LogLevel.String()),
		slog.String("log_format", c.LogFormat),
	)
}

func redactURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return "[invalid url]"
	}
	return u.Redacted()
}

type loader struct {
	lookup   LookupFunc
	problems []string
}

func (l *loader) problemf(key, msg string) {
	l.problems = append(l.problems, key+" "+msg)
}
func (l *loader) get(key string) (string, bool) {
	v, ok := l.lookup(key)
	v = strings.TrimSpace(v)
	if !ok || v == "" {
		return "", false
	}
	return v, true
}

func (l *loader) requiredURL(key string, schemes ...string) string {
	v, ok := l.get(key)
	if !ok {
		l.problemf(key, "is required")
		return ""
	}
	u, err := url.Parse(v)
	if err != nil {
		l.problemf(key, "is not a valid URL")
		return ""
	}
	if !contains(schemes, u.Scheme) {
		l.problemf(key, "must use one of the schemes: "+strings.Join(schemes, ", "))
		return ""
	}
	if u.Host == "" {
		l.problemf(key, "must include a host")
		return ""
	}
	return v
}

func (l *loader) intInRange(key string, def, minVal, maxVal int) int {
	v, ok := l.get(key)
	if !ok {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < minVal || n > maxVal {
		l.problemf(key, "must be an integer between "+strconv.Itoa(minVal)+" and "+strconv.Itoa(maxVal))
		return def
	}
	return n
}

func (l *loader) logLevel() slog.Level {
	v, ok := l.get(EnvLogLevel)
	if !ok {
		return slog.LevelInfo
	}
	level, err := logging.ParseLevel(v)
	if err != nil {
		l.problemf(EnvLogLevel, "must be one of: debug, info, warn, error")
		return slog.LevelInfo
	}
	return level
}

func (l *loader) logFormat() string {
	v, ok := l.get(EnvLogFormat)
	if !ok {
		return logging.FormatJSON
	}
	v = strings.ToLower(v)
	if v != logging.FormatJSON && v != logging.FormatText {
		l.problemf(EnvLogFormat, "must be one of: json, text")
		return logging.FormatJSON
	}
	return v
}

func contains(list []string, s string) bool {
	for _, item := range list {
		if item == s {
			return true
		}
	}
	return false
}
