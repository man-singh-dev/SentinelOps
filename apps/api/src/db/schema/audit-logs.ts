import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users";

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // The user who performed the action (null for system-generated actions)
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),

    // What was done (e.g. "incident.acknowledged", "service.api_key.rotated")
    action: varchar("action", { length: 255 }).notNull(),

    // The type of resource affected (e.g. "incident", "service", "user")
    targetType: varchar("target_type", { length: 100 }).notNull(),

    // The UUID of the affected resource
    targetId: uuid("target_id").notNull(),

    // Optional structured context (IP address, old/new values, etc.)
    metadata: jsonb("metadata"),

    summary: text("summary"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Query: "all audit log entries for a given resource"
    index("audit_logs_target_idx").on(t.targetType, t.targetId),
    // Query: "all actions performed by a given user"
    index("audit_logs_actor_id_idx").on(t.actorId),
  ],
);

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
