import * as path from "path";
import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set");
}

export default defineConfig({
  dialect: "postgresql",
  // Schema files will live here once tables are defined
  schema: "./src/db/schema",
  // Migrations go to the repo-level db/migrations directory
  out: "../../db/migrations",
  dbCredentials: {
    url: databaseUrl,
  },
  strict: true,
  verbose: true,
});
