import pg from 'pg';

/**
 * Phase 0 only uses this pool for the /readyz connectivity check. Query
 * building/ORM decisions are deferred until there's a real query to write.
 */
export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString });
}
