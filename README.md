# SentinelOps

**Real-time incident intelligence and service reliability platform.**

SentinelOps ingests high-volume events from applications and infrastructure, deduplicates and correlates them into incidents, and gives engineering teams a live dashboard to investigate and resolve failures.

> **10,000 identical `payment-service` failures should produce 1 incident with 10,000 related events, not 10,000 alerts.**

![Node.js](https://img.shields.io/badge/API-Node.js%20%2B%20TypeScript-339933?logo=node.js&logoColor=white)
![Go](https://img.shields.io/badge/Workers-Go-00ADD8?logo=go&logoColor=white)
![React](https://img.shields.io/badge/Dashboard-React%20%2B%20TypeScript-61DAFB?logo=react&logoColor=black)
![PostgreSQL](https://img.shields.io/badge/DB-PostgreSQL-4169E1?logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Cache-Redis-DC382D?logo=redis&logoColor=white)
![RabbitMQ](https://img.shields.io/badge/Queue-RabbitMQ-FF6600?logo=rabbitmq&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)

---

## Table of Contents

1. [Project Status](#project-status)
2. [Why SentinelOps](#why-sentinelops)
3. [High-Level Architecture](#high-level-architecture)
4. [Event Lifecycle](#event-lifecycle)
5. [Core Concepts](#core-concepts)
6. [Tech Stack and Rationale](#tech-stack-and-rationale)
7. [Repository Structure](#repository-structure)
8. [Getting Started](#getting-started)
9. [API Overview](#api-overview)
10. [Data Model](#data-model)
11. [Security](#security)
12. [Observability](#observability)
13. [Scaling and Failure Modes](#scaling-and-failure-modes)
14. [Roadmap](#roadmap)
15. [Engineering Principles](#engineering-principles)
16. [Contributing](#contributing)
17. [License](#license)

---

## Project Status

SentinelOps is under active, incremental development. This README describes the **target design**. Features are marked honestly:

| Status | Meaning |
|--------|---------|
| ✅ Done | Implemented and tested |
| 🚧 In progress | Being built |
| 📋 Planned | Designed, not yet built |

See the [Roadmap](#roadmap) for the per-phase status. Nothing in this repository should be read as a production-readiness or performance claim until it is backed by tests and benchmarks that live in the repo.

---

## Why SentinelOps

During an outage, monitoring systems can generate thousands of near-identical alerts. Engineers drown in noise instead of fixing the problem. SentinelOps addresses this by:

- **Decoupling ingestion from processing**: the API accepts events fast and hands off heavy work to a queue.
- **Correlating events**: identical failures collapse into a single incident using a fingerprint and time window.
- **Being safe under retries**: duplicate deliveries are treated as one logical event.
- **Failing gracefully**: bounded retries with exponential backoff, then a Dead Letter Queue.
- **Updating live**: engineers see new incidents and state changes over WebSockets, with no refresh.

---

## High-Level Architecture

```mermaid
flowchart LR
    subgraph EXT["External Systems"]
        S1["Application Services"]
        S2["Infrastructure / Agents"]
    end

    subgraph EDGE["Edge"]
        NG["Nginx<br/>TLS / reverse proxy"]
    end

    subgraph API["Node.js + TypeScript API"]
        direction TB
        A1["Auth<br/>API key / JWT"]
        A2["Validation<br/>schema checks"]
        A3["Rate limiting<br/>Redis counters"]
        A4["Idempotency<br/>fast-path check"]
        A5["REST endpoints"]
        A6["WebSocket gateway"]
    end

    MQ[["RabbitMQ<br/>events queue<br/>retry queues<br/>DLQ"]]

    subgraph WORKERS["Go Worker Service"]
        direction TB
        W1["Consumer"]
        W2["Worker pool<br/>goroutines + channels"]
        W3["Dedup + correlation<br/>incident engine"]
    end

    subgraph DATA["Data Layer"]
        PG[("PostgreSQL<br/>source of truth")]
        RD[("Redis<br/>cache, rate limits,<br/>idempotency, pub/sub")]
    end

    subgraph UI["Frontend"]
        FE["React + TypeScript<br/>Tailwind + React Query"]
    end

    S1 -->|"POST /api/v1/events"| NG
    S2 -->|"POST /api/v1/events"| NG
    NG --> A1
    A1 --> A2 --> A3 --> A4
    A4 -->|"publish"| MQ
    A3 <--> RD
    A4 <--> RD

    MQ -->|"consume"| W1 --> W2 --> W3
    W3 -->|"transactions"| PG
    W3 -->|"publish updates"| RD

    RD -->|"subscribe"| A6
    A5 <-->|"queries"| PG
    A5 <-->|"hot reads"| RD

    FE -->|"HTTPS REST"| NG
    FE <-->|"WebSocket"| A6
    NG --> A5
    NG --> A6
```

### Component responsibilities

| Component | Responsibility | Deliberately does NOT do |
|-----------|----------------|--------------------------|
| **Node.js API** | Authenticate, validate, rate limit, enqueue events; serve dashboard REST APIs; push real-time updates | Heavy event processing |
| **RabbitMQ** | Durable buffer between ingestion and processing; retry and dead-letter routing | Business logic |
| **Go workers** | Concurrent event processing, fingerprinting, deduplication, incident create/attach | Serve user-facing HTTP |
| **PostgreSQL** | Source of truth for events, incidents, users, audit logs | Low-latency counters |
| **Redis** | Rate limiting, short-lived idempotency keys, hot caches, pub/sub fan-out to WebSocket nodes | Durable storage |
| **React dashboard** | Overview, incident list/detail, service health, live updates | Any business logic |

---

## Event Lifecycle

The full path of a single event from arrival to dashboard update:

```mermaid
sequenceDiagram
    autonumber
    participant Svc as External Service
    participant API as Node.js API
    participant R as Redis
    participant MQ as RabbitMQ
    participant W as Go Worker
    participant PG as PostgreSQL
    participant WS as WebSocket Gateway
    participant UI as React Dashboard

    Svc->>API: POST /api/v1/events (API key)
    API->>API: Authenticate and validate payload
    API->>R: Rate limit check
    alt limit exceeded
        API-->>Svc: 429 Too Many Requests
    end
    API->>R: SETNX idempotency key (event_id)
    alt duplicate event_id
        API-->>Svc: 202 Accepted (already received)
    end
    API->>MQ: Publish event (persistent)
    API-->>Svc: 202 Accepted

    MQ->>W: Deliver event
    W->>W: Compute fingerprint
    W->>PG: BEGIN
    W->>PG: Insert event (unique service_id + event_id)
    W->>PG: Find active incident by fingerprint and window
    alt no active incident
        W->>PG: Create incident and timeline entry
    else incident exists
        W->>PG: Link event, update last_detected_at and count
    end
    W->>PG: COMMIT
    W->>MQ: ACK
    W->>R: Publish incident update
    R->>WS: Pub/Sub message
    WS->>UI: WebSocket push (incident.created / updated)
```

**Key point:** the API returns `202 Accepted` as soon as the event is durably queued. Processing is asynchronous, so ingestion latency stays low and is independent of database load.

---

## Core Concepts

### 1. Deduplication and correlation

Each event is reduced to a **fingerprint**:

```
fingerprint = hash(service + event_type + normalized_error_signature)
```

The worker looks up an **active incident** (not `RESOLVED`) with the same fingerprint inside a configurable **time window**. If found, the event is attached; otherwise, a new incident is created.

- **Severity escalation:** if an attached event has higher severity, the incident severity is raised and a `severity_changed` event is emitted.
- **Race safety:** two workers may process the same fingerprint simultaneously. A partial unique index on `(fingerprint) WHERE status <> 'RESOLVED'`, combined with `INSERT ... ON CONFLICT`, guarantees only one incident is created.
- **Normalization:** volatile values (IDs, timestamps, memory addresses) are stripped from error messages so equivalent failures produce the same signature.

### 2. Idempotency (two layers)

| Layer | Mechanism | Purpose |
|-------|-----------|---------|
| Fast path | Redis `SET NX` with TTL on `event_id` | Reject obvious duplicates before they hit the queue |
| Source of truth | PostgreSQL unique constraint on `(service_id, event_id)` | Correctness even if Redis is empty, evicted, or down |

Redis is an optimization; PostgreSQL is the guarantee. If `abc123` arrives three times, exactly one logical event is stored.

### 3. Retries, exponential backoff and Dead Letter Queue

```mermaid
flowchart LR
    Q[["events queue"]] --> W["Worker"]
    W -->|"success"| ACK["ACK"]
    W -->|"failure, attempt < max"| R1[["retry queue<br/>TTL grows per attempt<br/>e.g. 1s, 5s, 30s"]]
    R1 -->|"TTL expires, dead-lettered back"| Q
    W -->|"failure, attempt = max"| DLQ[["Dead Letter Queue"]]
    DLQ -.->|"inspect / reprocess"| OPS["Engineer"]
```

- Attempt count is tracked in message headers.
- Retries are bounded, so there are no infinite loops.
- Poison messages land in the DLQ with the failure reason attached, and can be inspected and replayed.
- Workers only ACK after the database transaction commits (at-least-once delivery, made safe by idempotency).

### 4. Go worker pool

```mermaid
flowchart LR
    C["RabbitMQ consumer<br/>(prefetch = N)"] --> J(["jobs channel<br/>buffered"])
    J --> G1["worker 1"]
    J --> G2["worker 2"]
    J --> G3["worker ... N"]
    G1 & G2 & G3 --> DB[("PostgreSQL<br/>pooled connections")]
    CTX["context.Context<br/>SIGTERM"] -.->|"cancel"| C
    CTX -.->|"drain in-flight jobs"| G1 & G2 & G3
```

- A fixed number of goroutines pull from a buffered channel; the buffer size and RabbitMQ prefetch provide **backpressure**.
- **Graceful shutdown:** on `SIGTERM`, the consumer stops accepting messages, in-flight jobs finish (bounded by a timeout), and unacked messages are redelivered.
- Every DB call uses a `context` with a timeout.

### 5. Incident lifecycle

```mermaid
stateDiagram-v2
    [*] --> OPEN: first matching event
    OPEN --> ACKNOWLEDGED: engineer acknowledges
    ACKNOWLEDGED --> INVESTIGATING: engineer starts work
    INVESTIGATING --> RESOLVED: fix confirmed
    OPEN --> RESOLVED: auto/manual resolve
    RESOLVED --> OPEN: regression (reopen)
    RESOLVED --> [*]
```

Every transition writes an `incident_timeline` row and an `audit_logs` entry.

### 6. Rate limiting

Per-API-key and per-IP counters in Redis using a sliding-window or token-bucket algorithm. Exceeding a limit returns `429` with a `Retry-After` header.

### 7. Redis usage (deliberately narrow)

| Use case | Why Redis |
|----------|-----------|
| Rate limit counters | Atomic, fast, shared across API instances |
| Idempotency keys (TTL) | Short-lived, cheap dedup fast path |
| Dashboard stats / service health cache | Read-heavy, tolerant to seconds of staleness |
| Pub/Sub for real-time updates | Lets multiple API instances broadcast to their own WebSocket clients |

PostgreSQL remains the source of truth for everything.

---

## Tech Stack and Rationale

| Layer | Choice | Why |
|-------|--------|-----|
| Frontend | React, TypeScript, Tailwind, React Query | Typed UI; React Query handles caching, refetching and WebSocket-driven invalidation |
| API | Node.js, TypeScript, Fastify | Strong I/O concurrency, schema-based validation, low overhead |
| Workers | Go | Goroutines and channels suit CPU/IO-bound concurrent processing and graceful shutdown |
| Queue | RabbitMQ | Per-message ACK, TTL and dead-letter exchanges map directly to retries and DLQ |
| Database | PostgreSQL | Transactions, constraints, partial unique indexes, relational integrity |
| Cache | Redis | Atomic counters, TTL keys, pub/sub |
| Infra | Docker, Docker Compose, Nginx, GitHub Actions | Reproducible local env, reverse proxy, CI/CD |
| Cloud (later) | AWS | Deployment target |

**Why not Kafka?** Kafka excels at replayable, high-throughput event streams. SentinelOps needs per-message acknowledgement, delayed retries and DLQ routing, which RabbitMQ provides natively with less operational weight. This decision can be revisited if replay or very high throughput become requirements.

---

## Repository Structure

Target layout (created incrementally starting in Phase 0):

```
SentinelOps/
├── apps/
│   ├── api/                 # Node.js + TypeScript API (REST + WebSocket)
│   │   ├── src/
│   │   │   ├── modules/     # events, incidents, services, auth, users
│   │   │   ├── plugins/     # db, redis, queue, auth, rate-limit
│   │   │   └── ws/          # WebSocket gateway
│   │   └── tests/
│   └── web/                 # React + TypeScript dashboard
│       └── src/
├── services/
│   └── worker/              # Go worker service
│       ├── cmd/worker/      # entrypoint
│       └── internal/        # consumer, pool, incident engine, store
├── db/
│   └── migrations/          # versioned SQL migrations
├── infra/
│   ├── docker/
│   └── nginx/
├── docs/
│   ├── architecture.md
│   └── adr/                 # architecture decision records
├── .github/workflows/       # CI
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## Getting Started

> 📋 **Planned.** The commands below describe the intended developer workflow and will work once Phase 0 is complete.

### Prerequisites

- Docker and Docker Compose
- Node.js 20+ and pnpm/npm (for local API/web development)
- Go 1.22+ (for local worker development)

### Run locally

```bash
git clone https://github.com/man-singh-dev/SentinelOps.git
cd SentinelOps

cp .env.example .env        # fill in values; never commit secrets
docker compose up --build
```

| Service | URL |
|---------|-----|
| Dashboard | http://localhost:5173 |
| API | http://localhost:3000 |
| RabbitMQ management | http://localhost:15672 |

### Send a test event

```bash
curl -X POST http://localhost:3000/api/v1/events \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $SERVICE_API_KEY" \
  -d '{
    "event_id": "evt_abc123",
    "service": "payment-service",
    "event_type": "payment.failed",
    "severity": "critical",
    "message": "Gateway timeout while charging card",
    "timestamp": "2026-01-01T12:00:00Z",
    "metadata": { "region": "ap-south-1", "gateway": "stripe" }
  }'
```

Expected: `202 Accepted`. Sending the same `event_id` again must not create a second event.

### Configuration

All configuration is via environment variables (see `.env.example`). No secrets are hardcoded.

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `AMQP_URL` | RabbitMQ connection string |
| `JWT_SECRET` | User token signing |
| `WORKER_CONCURRENCY` | Number of worker goroutines |
| `DEDUP_WINDOW_SECONDS` | Correlation window for incidents |
| `MAX_RETRY_ATTEMPTS` | Attempts before DLQ |
| `RATE_LIMIT_PER_MINUTE` | Default per-key limit |

---

## API Overview

Base path: `/api/v1`. Final contract will be published as OpenAPI.

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/events` | Service API key | Ingest an event (returns `202`) |
| `GET` | `/incidents` | Viewer+ | List with filter, sort, pagination |
| `GET` | `/incidents/:id` | Viewer+ | Details, related events, timeline |
| `PATCH` | `/incidents/:id/status` | Engineer+ | Acknowledge / investigate / resolve |
| `POST` | `/incidents/:id/notes` | Engineer+ | Add a note |
| `GET` | `/services` | Viewer+ | Service list with health |
| `GET` | `/services/:id` | Viewer+ | Metrics, incidents, recent events |
| `POST` | `/services` | Admin | Register a service and issue API key |
| `GET` | `/stats/overview` | Viewer+ | Dashboard aggregates (cached) |
| `GET` | `/dlq` | Admin | Inspect dead-lettered events |
| `POST` | `/dlq/:id/reprocess` | Admin | Replay a dead-lettered event |
| `GET` | `/health`, `/metrics` | Internal | Liveness and Prometheus metrics |

**Real-time (WebSocket)** events: `incident.created`, `incident.severity_changed`, `incident.acknowledged`, `incident.resolved`, `service.health_changed`.

**Standard responses:** `202` accepted, `400` validation error, `401/403` auth errors, `409` conflict, `429` rate limited, `5xx` server errors, all using a consistent structured error body.

---

## Data Model

PostgreSQL is designed around real requirements; tables are added as features land, not all upfront.

```mermaid
erDiagram
    USERS ||--o{ AUDIT_LOGS : performs
    TEAMS ||--o{ USERS : has
    TEAMS ||--o{ SERVICES : owns
    SERVICES ||--o{ SERVICE_API_KEYS : has
    SERVICES ||--o{ EVENTS : emits
    SERVICES ||--o{ INCIDENTS : affected
    INCIDENTS ||--o{ INCIDENT_EVENTS : groups
    EVENTS ||--o{ INCIDENT_EVENTS : belongs
    INCIDENTS ||--o{ INCIDENT_TIMELINE : records
    USERS ||--o{ INCIDENTS : assigned

    EVENTS {
        uuid id PK
        text event_id "client-supplied"
        uuid service_id FK
        text event_type
        text severity
        text fingerprint
        jsonb metadata
        timestamptz occurred_at
        timestamptz received_at
    }
    INCIDENTS {
        uuid id PK
        uuid service_id FK
        text title
        text severity
        text status
        text fingerprint
        int event_count
        timestamptz first_detected_at
        timestamptz last_detected_at
        uuid assigned_to FK
    }
    INCIDENT_TIMELINE {
        uuid id PK
        uuid incident_id FK
        text kind
        uuid actor_id FK
        jsonb detail
        timestamptz created_at
    }
```

**Important constraints and indexes**

- `UNIQUE (service_id, event_id)` on `events`, the idempotency guarantee.
- Partial unique index on `incidents (fingerprint) WHERE status <> 'RESOLVED'`, preventing duplicate active incidents.
- Indexes on `incidents (status, severity, last_detected_at DESC)` for list queries.
- `CHECK` constraints on severity and status enums.
- Keyset (cursor) pagination for large lists.
- Consider time-based partitioning of `events` as volume grows.

---

## Security

| Concern | Approach |
|---------|----------|
| User authentication | Password hashing (argon2/bcrypt) + short-lived JWT access tokens |
| Service authentication | Per-service API keys; only hashes stored; revocable and rotatable |
| Authorization | RBAC: **Admin** (users, services, settings), **Engineer** (investigate, acknowledge, resolve, notes), **Viewer** (read-only) |
| Input validation | Schema validation on every external input |
| Abuse protection | Redis-backed rate limiting, payload size limits |
| Audit logging | Actor, action, target and timestamp for security-relevant actions, e.g. `USER_A ACKNOWLEDGED INCIDENT INC-1024` |
| Secrets | Environment variables only; `.env` is gitignored |
| Transport | TLS terminated at Nginx |

---

## Observability

SentinelOps monitors itself (Phase 8):

- **Metrics:** events processed/sec, queue depth, worker utilization, processing latency, retry count, failed events, API latency, DB pool health
- **Logs:** structured JSON with correlation/request IDs across API and workers
- **Health:** `/health` (liveness) and readiness checks for PostgreSQL, Redis and RabbitMQ

---

## Scaling and Failure Modes

| Scenario | Behavior |
|----------|----------|
| Traffic spike | API keeps accepting; queue absorbs the burst; workers drain at their own pace |
| Slow workers | Queue depth grows (visible in metrics); scale worker replicas horizontally |
| Worker crash mid-job | Message is unacked and redelivered; idempotency prevents double effects |
| Duplicate delivery | Redis fast path + PostgreSQL unique constraint |
| Redis unavailable | Rate limiting falls back per policy; idempotency still enforced by PostgreSQL |
| PostgreSQL slow or down | Workers retry with backoff, then DLQ; API still enqueues |
| Poison message | Bounded retries, then DLQ for inspection |
| Multiple API instances | Redis pub/sub fans real-time updates out to every WebSocket node |

**Scaling levers:** API instances behind Nginx (stateless), worker replicas consuming the same queue, PostgreSQL read replicas and partitioning, Redis for hot reads.

**Known trade-offs**

- At-least-once delivery means correctness depends on idempotent writes.
- Eventual consistency between ingestion and dashboard (typically sub-second, not guaranteed).
- Redis pub/sub is fire-and-forget; the dashboard should refetch on reconnect.

---

## Roadmap

| Phase | Scope | Status |
|-------|-------|--------|
| 0 | Foundation: repo structure, API/web/worker skeletons, Docker Compose, PostgreSQL, Redis, CI | 📋 Planned |
| 1 | Core backend: domain models, `Event → API → PostgreSQL` | 📋 Planned |
| 2 | Event-driven: `API → RabbitMQ → Go worker → PostgreSQL` | 📋 Planned |
| 3 | Reliability: dedup, idempotency, retries, backoff, DLQ | 📋 Planned |
| 4 | Redis: caching, rate limiting, short-lived state | 📋 Planned |
| 5 | Real-time: WebSockets and live updates | 📋 Planned |
| 6 | Frontend: overview, incident list/detail, service views | 📋 Planned |
| 7 | Security: auth, RBAC, service API keys, audit logs | 📋 Planned |
| 8 | Observability: metrics, tracing, health | 📋 Planned |
| 9 | Deployment: containers, CI/CD, AWS | 📋 Planned |

Update this table as phases are actually completed and tested.

---

## Engineering Principles

- Every technology solves a real problem; nothing is added for résumé value.
- Simple, maintainable code over unnecessary abstraction.
- Validate all external input; never hardcode secrets.
- Tests for important business logic (fingerprinting, dedup, lifecycle transitions, retry policy).
- Structured errors and structured logging throughout.
- Small, meaningful commits.
- No unverified performance or production claims; benchmarks are added to `docs/` with reproducible steps.

Architecture decisions are recorded as ADRs in [`docs/adr`](docs/adr).

---

## Contributing

1. Fork the repo and create a feature branch (`feat/<short-description>`).
2. Keep changes focused; add or update tests.
3. Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`).
4. Open a pull request describing what changed and why.

---

## License

To be decided. Add a `LICENSE` file (e.g. MIT) before accepting external contributions.
