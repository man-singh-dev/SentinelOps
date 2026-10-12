import {
  pgTable,
  uuid,
  text,
  varchar,
  timestamp,
  pgEnum,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { services } from "./services";

export const eventSeverityEnum = pgEnum("event_severity", [
  "critical",
  "high",
  "medium",
  "low",
]);

export const events = pgTable(
  "events",
  {
    //columns
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: varchar("event_id", { length: 255 }).notNull(),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
    eventType: varchar("event_type", { length: 255 }).notNull(),
    severity: eventSeverityEnum("severity").notNull(),
    // Computed by the worker: hash(service + event_type + normalized_error_signature)
    fingerprint: text("fingerprint").notNull(),
    // Raw message / description from the external system
    message: text("message"),
    // Arbitrary structured metadata from the emitting service
    metadata: jsonb("metadata"),
    // When the event actually occurred on the emitting system
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    // When the API received the event (for diagnostics and ordering audit)
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Core idempotency guarantee (Invariant #2, Guarantees table).
    // INSERT ... ON CONFLICT (service_id, event_id) DO NOTHING makes retries safe.
    uniqueIndex("events_service_id_event_id_uidx").on(t.serviceId, t.eventId),
    // Support fast fingerprint lookups during correlation
    index("events_fingerprint_idx").on(t.fingerprint),
    // Support time-range queries
    index("events_occurred_at_idx").on(t.occurredAt),
  ],
);

export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
