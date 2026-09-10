# 0004. Postgres-only infrastructure; defer the message queue

## Status
Accepted

## Context
SentinelOps's eventual architecture routes ingested events through a
message queue to a worker pool. Redis and RabbitMQ were both considered
for that queue in earlier planning. Phase 0's explicit goal is to prove
service wiring, not to build ingestion.

## Decision
`docker-compose.yml` runs Postgres only. No Redis, no RabbitMQ. The
worker's only "work" in this phase is a heartbeat; there is nothing for
a queue to feed it yet.

The eventual choice between Redis Streams and RabbitMQ/Kafka is
deferred to the phase that actually adds event ingestion, once there's
a real (even if rough) sense of expected throughput and delivery
guarantees needed. Redis Streams is the leading candidate over Kafka:
Kafka's operational overhead isn't justified by unproven throughput,
and Redis Streams' consumer-group semantics are sufficient for a single
worker pool - but that decision is not locked in by this ADR.

## Consequences
- Local dev stays to two moving parts (Postgres, plus the three apps),
  not four.
- Nothing is running that nothing yet depends on.
- The queue decision gets made with actual requirements in hand, not
  speculatively now.
