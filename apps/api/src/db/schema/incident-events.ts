import { pgTable, uuid, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { incidents } from "./incidents";
import { events } from "./events";

export const incidentEvents = pgTable(
  "incident_events",
  {
    incidentId: uuid("incident_id")
      .notNull()
      .references(() => incidents.id, { onDelete: "cascade" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    // When this event was attached to the incident (may differ from event.occurred_at)
    attachedAt: timestamp("attached_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.incidentId, t.eventId] })],
);

export type IncidentEvent = typeof incidentEvents.$inferSelect;
export type NewIncidentEvent = typeof incidentEvents.$inferInsert;
