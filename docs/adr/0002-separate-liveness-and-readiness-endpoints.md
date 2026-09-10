# 0002. Separate liveness and readiness endpoints

## Status
Accepted

## Context
The API needs a way for an orchestrator or load balancer to know its
health. A single `/health` endpoint that checks everything (including
Postgres) conflates two different questions: "is this process alive"
and "can this process correctly serve a request right now."

## Decision
Two endpoints:
- `GET /healthz` - liveness. Returns 200 if the process is running.
  Touches no dependencies.
- `GET /readyz` - readiness. Runs `SELECT 1` against Postgres; returns
  503 if it fails.

## Consequences
- If Postgres goes down, `/healthz` still returns 200 (the API process
  itself is fine) and `/readyz` returns 503. An orchestrator using these
  correctly will pull the instance from load-balancer rotation (acting
  on readiness) without restarting it (which liveness would trigger).
- Restarting the API would not fix a dead database - coupling liveness to
  a dependency check would produce a restart loop that adds instability
  without addressing the actual problem.
- This mirrors the same distinction Kubernetes liveness/readiness probes
  are built around, even though nothing is deployed to Kubernetes yet.
