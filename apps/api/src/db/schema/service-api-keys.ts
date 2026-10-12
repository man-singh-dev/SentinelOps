import { pgTable, uuid, varchar, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { services } from "./services";

// Per-service API keys used to authenticate event ingestion.
// README Security: "Per-service API keys; only hashes stored; revocable and rotatable."
// README ER diagram: SERVICES ||--o{ SERVICE_API_KEYS : has
export const serviceApiKeys = pgTable("service_api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),

  serviceId: uuid("service_id")
    .notNull()
    .references(() => services.id, { onDelete: "cascade" }),

  // A short human-readable label (e.g. "production", "staging")
  name: varchar("name", { length: 255 }).notNull(),

  // Only the hash is stored; the plaintext key is shown once and discarded.
  keyHash: text("key_hash").notNull().unique(),

  // A short prefix of the key shown in the UI for identification (e.g. "sk_abc...")
  keyPrefix: varchar("key_prefix", { length: 16 }).notNull(),

  isRevoked: boolean("is_revoked").notNull().default(false),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Key rotation: create a new key and revoke the old one (never update the hash)
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
});

export type ServiceApiKey = typeof serviceApiKeys.$inferSelect;
export type NewServiceApiKey = typeof serviceApiKeys.$inferInsert;
