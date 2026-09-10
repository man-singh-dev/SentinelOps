# 0003. Go worker ships with zero third-party dependencies in Phase 0

## Status
Accepted

## Context
The worker's only job in this phase is to prove the process-lifecycle
skeleton: load config, log in structured JSON, and shut down gracefully
on signal. There is no queue to consume and no database to write to yet.

## Decision
The worker uses only the Go standard library: `log/slog` for structured
logging, `context` + `os/signal` + `sync.WaitGroup` for graceful
shutdown, `time` for the heartbeat ticker. No queue client, no DB
driver, no config-loading library (env vars are read and validated by
hand in `internal/config`, which is small enough not to need one).

## Consequences
- Nothing is imported to serve a requirement that doesn't exist yet.
  When a queue consumer or DB writer is added, its dependency arrives
  with it, in the commit that needs it.
- The graceful-shutdown skeleton (`signal.NotifyContext`, a
  `sync.WaitGroup`, a bounded shutdown timeout) is proven now, before
  there's real work to drain. Future goroutines register with the same
  `wg.Add(1)` / select-on-`ctx.Done()` pattern the heartbeat already
  uses, so adding real work doesn't change the shutdown shape.
- `go.sum` doesn't exist yet, so CI module caching is disabled rather
  than pointed at a file that doesn't exist.
