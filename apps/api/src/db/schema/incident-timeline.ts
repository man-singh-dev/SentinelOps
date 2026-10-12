import { pgTable, uuid, timestamp, jsonb, pgEnum, index } from "drizzle-orm/pg-core";
import { incidents } from "./incidents";
import { users } from "./users";

// README ER diagram table name: INCIDENT_TIMELINE
// README Core Design §6: "Every transition writes an incident_timeline row"
// README Invariant #5: "Every incident state transition has a matching incident_timeline row"
export const incidentTimelineKindEnum = pgEnum("incident_timeline_kind", [
  "incident_opened",
  "status_changed", // open → acknowledged → investigating → resolved → open
  "severity_changed", // higher-severity event escalated the incident
  "assignee_changed",
  "note_added", // POST /incidents/:id/notes
  "incident_resolved",
  "incident_reopened",
]);

export const incidentTimeline = pgTable(
  "incident_timeline",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    incidentId: uuid("incident_id")
      .notNull()
      .references(() => incidents.id, { onDelete: "cascade" }),

    // README ER diagram column: "kind"
    kind: incidentTimelineKindEnum("kind").notNull(),

    // The user who caused this event (null for system/worker-generated entries)
    // README ER diagram column: "actor_id"
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),

    // Structured event-specific data (old/new values, comment text, etc.)
    // README ER diagram column: "detail" (jsonb — not plain text)
    detail: jsonb("detail"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Fast timeline fetches per incident (most common access pattern)
    index("incident_timeline_incident_id_idx").on(t.incidentId),
  ],
);

export type IncidentTimelineEntry = typeof incidentTimeline.$inferSelect;
export type NewIncidentTimelineEntry = typeof incidentTimeline.$inferInsert;
