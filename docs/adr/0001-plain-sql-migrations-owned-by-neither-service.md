# 0001. Plain SQL migrations, owned by neither service

## Status
Accepted

## Context
SentinelOps has two backend languages: a Node/TypeScript API and a Go
worker, both of which will eventually read and write the same Postgres
schema. If schema migrations were owned by an ORM tied to one language
(e.g. Prisma on the Node side), that tool's proprietary migration format
would implicitly make one language the schema's source of truth, and the
other language would be coding against a schema it doesn't control.

## Decision
Migrations are plain `.up.sql` / `.down.sql` files in `db/migrations/`,
applied by the `golang-migrate` CLI (running as the official
`migrate/migrate` Docker image, not a code dependency of either app).
Despite the name, `golang-migrate` operates on plain SQL - it isn't a Go
library either service imports.

`golang-migrate` tracks applied versions in a `schema_migrations` table,
so re-running `migrate up` is a no-op for already-applied migrations.

## Consequences
- Both api (via a lightweight query builder, not an ORM) and worker
  (via `pgx`) treat the Postgres schema itself as the contract, not an
  ORM's internal representation of it.
- Adding a migration is a plain SQL file, reviewable without knowing
  either app's language.
- No ORM-driven type generation for free - each side's query layer is
  responsible for its own typing against the schema.
