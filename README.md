# SentinelOps

A distributed, real-time incident intelligence platform. Events from
external services are ingested by an API, published to a message queue,
processed concurrently by a Go worker pool (deduplication, correlation,
incident creation), persisted to PostgreSQL, and pushed to a React
dashboard.

## Phase 0 — this repository, right now

This phase proves the wiring between services. **There is no business
logic yet** — no event ingestion, no queue, no incident creation. See
`docs/adr/` for why each piece looks the way it does.

What exists:
- `apps/api` — Fastify + TypeScript. `/healthz` (liveness) and `/readyz`
  (readiness, checks Postgres) only.
- `apps/worker` — Go. Logs a heartbeat every 5s and implements graceful
  shutdown. No queue consumer yet.
- `apps/web` — React + Vite. One page that calls the api's `/readyz` and
  shows the result.
- `db/migrations` — plain SQL migrations, run by `golang-migrate`, owned
  by neither service.
- `docker-compose.yml` — Postgres + the three apps, for local dev only.

## Running locally

```bash
cp .env.example .env
docker compose up --build
```

- API: http://localhost:3000/healthz, http://localhost:3000/readyz
- Web: http://localhost:5173

## Running migrations

Migrations are applied via the `migrate` one-off compose service:

```bash
docker compose --profile tools run --rm migrate up
```

## Structure

```
apps/api/      Node 20 + TypeScript + Fastify
apps/worker/   Go 1.22+
apps/web/      React + TypeScript + Vite
db/migrations/ Plain SQL, applied by golang-migrate
deploy/docker/ Dockerfiles (dev only — hot reload, not production images)
docs/adr/      Architecture decision records
```

## Roadmap (not this phase)

Event ingestion, message queue, worker doing real processing,
deduplication/correlation, incident model, WebSocket push to the
dashboard, authentication, deployment.
