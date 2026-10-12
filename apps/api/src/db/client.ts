import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../config/env";

export const createDb = (connectionString: string = env.DATABASE_URL) => {
  const client = postgres(connectionString, {
    max: 10,
  });

  const db = drizzle(client);

  return {
    db,
    client,
    close: () => client.end(),
  };
};

export type DbConnection = ReturnType<typeof createDb>;
export type Database = DbConnection["db"];
