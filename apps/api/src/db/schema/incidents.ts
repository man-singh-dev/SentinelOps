import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  pgEnum,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { services } from "./services";

export const incidentSeverityEnum = pgEnum("incident_severity", [
  "sev1", // Critical — full outage
  "sev2", // Major — significant degradation
  "sev3", // Minor — partial or low-impact issue
  "sev4", // Low — cosmetic or edge case
]);

// README lifecycle: OPEN → ACKNOWLEDGED → INVESTIGATING → RESOLVED → OPEN (reopen)
export const incidentStatusEnum = pgEnum("incident_status", [
  "open",
  "acknowledged",
  "investigating",
  "resolved",
]);

export const incidents = pgTable(
  "incidents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: varchar("title", { length: 500 }).notNull(),
    description: text("description"),
    severity: incidentSeverityEnum("severity").notNull(),
    status: incidentStatusEnum("status").notNull().default("open"),

    // Fingerprint: hash(service + event_type + normalized_error_signature).
    // Drives the partial unique index that prevents duplicate active incidents.
    fingerprint: text("fingerprint").notNull(),

    // Denormalised counter kept in-sync with incident_events rows (Invariant #4).
    eventCount: integer("event_count").notNull().default(0),

    // Time boundaries driven by occurred_at of attached events (out-of-order safe).
    firstDetectedAt: timestamp("first_detected_at", { withTimezone: true }).notNull(),
    lastDetectedAt: timestamp("last_detected_at", { withTimezone: true }).notNull(),

    // Owning service (nullable — can be filed before service is known)
    serviceId: uuid("service_id").references(() => services.id, {
      onDelete: "set null",
    }),

    // Assigned responder
    assigneeId: uuid("assignee_id").references(() => users.id, {
      onDelete: "set null",
    }),

    // The user who filed the incident
    reportedById: uuid("reported_by_id").references(() => users.id, {
      onDelete: "set null",
    }),

    resolvedAt: timestamp("resolved_at", { withTimezone: true }),

    // Human-readable reference number (e.g. INC-42).
    // Must be supplied by the application (e.g. from a sequence) — no DB default.
    sequenceNumber: integer("sequence_number").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Core correctness guarantee: at most one non-resolved incident per fingerprint.
    // Race-safe: two concurrent workers serialise on this index via ON CONFLICT.
    uniqueIndex("incidents_fingerprint_active_uidx")
      .on(t.fingerprint)
      .where(sql`status <> 'resolved'`),

    // Performance index for the main incident list query (status + severity filter,
    // ordered by most recent activity).
    index("incidents_status_severity_last_detected_idx").on(
      t.status,
      t.severity,
      t.lastDetectedAt,
    ),
  ],
);

export type Incident = typeof incidents.$inferSelect;
export type NewIncident = typeof incidents.$inferInsert;
