import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../config/env";
import * as schema from "./schema/index";

export const createDb = (connectionString: string = env.DATABASE_URL) => {
  const client = postgres(connectionString, {
    max: 10,
  });

  const db = drizzle(client, { schema });

  return {
    db,
    client,
    close: () => client.end(),
  };
};

export type DbConnection = ReturnType<typeof createDb>;//extract the return type of the createDb function
export type Database = DbConnection["db"];
