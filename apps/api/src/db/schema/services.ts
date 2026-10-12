import { pgTable, uuid, varchar, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { teams } from "./teams";

export const serviceStatusEnum = pgEnum("service_status", [
  "operational",
  "degraded",
  "partial_outage",
  "major_outage",
  "maintenance",
]);

export const services = pgTable("services", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull().unique(),
  description: text("description"),
  status: serviceStatusEnum("status").notNull().default("operational"),
  // Owning team (nullable — a service may not be owned by a team initially)
  ownerTeamId: uuid("owner_team_id").references(() => teams.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Service = typeof services.$inferSelect;
export type NewService = typeof services.$inferInsert;
