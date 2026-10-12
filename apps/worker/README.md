# SentinelOps Worker

Go service that will consume events from RabbitMQ and correlate them into incidents.

> **Status: skeleton.** It loads and validates configuration, sets up structured
> logging, and shuts down gracefully on `SIGINT`/`SIGTERM`. It does **not** yet consume
> messages, deduplicate events, or touch PostgreSQL/Redis.

## Layout

```
apps/worker/
├── cmd/worker/main.go        # entry point: wiring, signals, exit codes
└── internal/
    ├── app/                  # lifecycle: runs Components, bounded graceful shutdown
    ├── config/               # env loading + validation (collects all problems)
    └── logging/              # slog logger construction (JSON or text)
```

New functionality (RabbitMQ consumer, worker pool, ...) should implement
`app.Component` (`Name()` + `Run(ctx) error`) and be passed to `app.New` in `main.go`.

## Requirements

- Go 1.27+ (see `go.mod`)

## Configuration

All configuration is via environment variables. The worker does **not** read `.env`
itself; export the variables into your shell first (see below).

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | yes | – | PostgreSQL URL (`postgres://` or `postgresql://`) |
| `RABBITMQ_URL` | yes | – | AMQP URL (`amqp://` or `amqps://`) |
| `WORKER_CONCURRENCY` | no | `4` | Worker goroutines (1–1024) |
| `WORKER_PREFETCH` | no | `10` | RabbitMQ prefetch count (1–65535) |
| `SHUTDOWN_TIMEOUT_SECONDS` | no | `30` | Max time to drain after a shutdown signal (1–3600) |
| `LOG_LEVEL` | no | `info` | `debug`, `info`, `warn`, `error` |
| `LOG_FORMAT` | no | `json` | `json` or `text` (text is nicer locally) |

Invalid or missing configuration is logged as a list of problems (values are never
printed, since they may contain credentials) and the process exits with code `2`.
Connection strings are logged with passwords redacted.

## Run locally

From the repository root, copy `.env.example` to `.env` if you haven't already, then:

**PowerShell**

```powershell
cd apps/worker
Get-Content ..\..\.env | Where-Object { $_ -match '^\s*[^#\s][^=]*=' } | ForEach-Object {
  $k, $v = $_ -split '=', 2
  Set-Item "Env:$($k.Trim())" $v.Trim()
}
$env:LOG_FORMAT = "text"
go run ./cmd/worker
```

**bash**

```bash
cd apps/worker
set -a; source ../../.env; set +a
LOG_FORMAT=text go run ./cmd/worker
```

Press `Ctrl+C` to stop. The worker logs `worker stopped cleanly` and exits `0`.
A second `Ctrl+C` during shutdown force-quits.

The infrastructure containers are not needed yet because the worker does not connect
to anything; start them with `docker compose up -d` once consumers are added.

## Development checks

```bash
gofmt -l .        # lists unformatted files; no output means OK
go vet ./...
go build ./...
go test ./...     # no tests exist yet
```

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | Clean shutdown |
| `1` | Runtime or startup failure (e.g. a component failed, shutdown timed out) |
| `2` | Invalid configuration |
