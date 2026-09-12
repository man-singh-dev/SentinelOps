import pg from 'pg';

/**
 * Phase 0 only uses this pool for the /readyz connectivity check. Query
 * building/ORM decisions are deferred until there's a real query to write.
 */
export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString });
}

// The subset of pg.Pool that request handlers actually use. Narrowed so
// tests can substitute a lightweight fake pool instead of standing up a
// real Postgres connection - pg.Pool satisfies this structurally, so
// nothing changes for production code.
export interface Queryable {
  query<T extends pg.QueryResultRow = never>(
    text: string,
    params?: unknown[],
  ): Promise<pg.QueryResult<T>>;
}
