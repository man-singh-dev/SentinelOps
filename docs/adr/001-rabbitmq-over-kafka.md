# ADR-001: Use RabbitMQ as the message broker (instead of Apache Kafka)

- **Status:** Accepted
- **Date:** 2026-10-12
- **Scope:** Message broker between the Node.js API (ingestion) and the Go workers (processing)

## Context

SentinelOps reduces alert noise. External services send failure events to the Node.js
API, which validates them and returns `202 Accepted`. Asynchronous Go workers then
fingerprint each event, deduplicate it, and either create a new incident or attach the
event to an existing one in PostgreSQL.

This needs a durable buffer between ingestion and processing with these properties:

- **Burst absorption.** A failing service can emit thousands of near-identical events
  in seconds. The API must keep accepting them while workers catch up.
- **Per-event outcomes.** Each event is processed independently. One bad event must
  not block the events behind it.
- **Bounded retries and a dead-letter path.** Transient failures (a database blip) are
  retried with backoff. Permanent failures (a malformed payload) are set aside for
  inspection and replay.
- **Competing consumers.** A pool of Go workers shares one queue, with backpressure
  through a prefetch limit.

The workload is a **task queue**, not an event log. Each message is a unit of work that
is done once and then discarded.

## Decision

Use **RabbitMQ** (AMQP 0-9-1) as the message broker for the current architecture. The
local stack runs `rabbitmq:3.13-management-alpine` (see `docker-compose.yml`). The API
publishes events with publisher confirms. Go workers consume with manual
acknowledgments and a bounded prefetch.

## Rationale

RabbitMQ gives SentinelOps the required behaviours as built-in broker features:

| Need | RabbitMQ feature |
|------|------------------|
| Per-event success/failure | Per-message `ack`, `nack` and `reject` |
| Don't lose in-flight work when a worker dies | Unacked messages are redelivered when the consumer's channel or connection closes |
| Poison messages and exhausted retries | Dead-letter exchanges (DLX) and dead-letter queues (DLQ) |
| Delayed retries with backoff | Queue-level TTL plus dead-lettering back to the main queue (retry queues) |
| Spread work over N workers | Competing consumers on one queue, with `prefetch` for backpressure |
| Route events differently later | Exchanges, routing keys and bindings (direct/topic) |
| Operate it ourselves | One broker, a management UI and a healthcheck out of the box |

The retry topology in the README (retry queues with growing TTL that dead-letter back
to the events queue, then a DLQ after the maximum attempts) maps directly onto these
features. On Kafka it would have to be built by hand.

## Alternatives considered

### Apache Kafka

Kafka is a partitioned, replicated, append-only log. Consumers track an offset.

- **Strengths.** Long retention and replay, strong per-partition ordering, very high
  throughput, and many independent consumer groups reading the same stream.
- **Why not now.**
  - It has no per-message ack/nack. Consumers commit offsets, so a poison message
    blocks its partition unless the application skips it.
  - It has no native dead-letter queue or delayed retry. We would build retry topics,
    delay handling and a DLQ topic ourselves.
  - Parallelism is capped by partition count, not worker count.
  - It means more to operate (partitions, offsets, retention, rebalances). We would be
    paying for replay that the current requirements do not ask for.

### Direct synchronous processing (no broker)

The API would fingerprint and write incidents inside the request.

- **Why not.**
  - Ingestion latency and availability become tied to PostgreSQL and the correlation
    logic.
  - A burst of events turns directly into slow or failed requests and database
    contention on hot incident rows.
  - Retries become the callers' problem.
  - It cannot absorb spikes, and the README keeps heavy processing out of the API.
- The roadmap builds ingestion synchronously in Stage 2 to prove the database
  constraints. That is a stepping stone, not the target design.

## Trade-offs and consequences

**Benefits**
- Retry, dead-letter and acknowledgment semantics come from the broker, so there is
  less custom code to get wrong.
- Worker scaling is simple: start more consumers.
- A small operational footprint suits the current project size.

**Limitations**
- **No replay.** Once a message is acknowledged it is gone. There is no log to
  re-read. Events that were never processed cannot be reconstructed from the broker.
  Only what has been persisted in PostgreSQL survives.
- **No ordering guarantee** across competing consumers, redelivery or retry queues. The
  design must not depend on arrival order. Incident time boundaries are therefore
  driven by each event's `occurred_at`, so out-of-order events are safe.
- **Throughput ceiling.** A broker cluster scales less far than a partitioned log. This
  is acceptable at the expected load and will be measured in the performance stage.
- **Queue type and availability are open.** The compose file is a single development
  node. Production would need a clustered setup, and the choice of classic or quorum
  queues is deferred to the pipeline stage.
- **Delay-tier retry queues.** With queue-level TTL, each delay (for example 1s, 5s,
  30s) needs its own queue. Per-message TTL on a single queue can leave an expired
  message waiting behind unexpired ones.

**Reconsidering the decision.** Revisit this ADR if requirements change, for example:
- We need to replay historical events (reprocessing after a correlation bug fix,
  backfills).
- Several independent systems (analytics, ML) need the same event stream.
- A hard per-key ordering requirement appears.
- Sustained throughput outgrows a RabbitMQ cluster.

To keep a later migration cheap, broker-specific code stays inside the worker's
consumer package and the API's queue plugin. Business logic does not depend on AMQP
types.

## Reliability considerations

RabbitMQ gives **at-least-once** delivery, not exactly-once. The design assumes
duplicates will happen.

- **Acknowledge after success.** A worker acks a message only after its PostgreSQL
  transaction commits. If the worker crashes first, the message is redelivered.
  Acking earlier would lose events on a crash.
- **Durability.** Messages survive a broker restart only if the queues are durable and
  the messages are published as persistent. The API should return `202` only after the
  broker has confirmed the publish.
- **Retries.** A transient failure sends the message to a retry queue with a growing
  delay. The attempt count is kept in message headers, and retries are bounded.
- **Dead letters.** A non-retryable error, or exhausting the maximum attempts, routes
  the message to the DLQ with the failure reason in its headers. Nothing is silently
  dropped, and entries can be inspected and replayed.
- **Duplicate delivery.** Duplicates come from redelivery after a crash between commit
  and ack, from retries, and from publisher retries after a lost confirm.
- **Idempotent processing.** Processing the same event twice must leave one logical
  event. PostgreSQL `UNIQUE (service_id, event_id)` is the guarantee. The Redis check
  is only a fast path and may be empty, evicted or down.
- **Backpressure.** The consumer's prefetch limit (`WORKER_PREFETCH`) bounds unacked
  messages per worker, and the worker pool's bounded channel stops intake from running
  ahead of processing.
- **Shutdown.** On `SIGTERM` the worker stops consuming, finishes in-flight jobs within
  the timeout, and leaves anything unacked for redelivery.

The gap between "event committed" and "idempotency key set or message acked" is a known
consistency edge. It will get its own ADR when the publish path is built.
