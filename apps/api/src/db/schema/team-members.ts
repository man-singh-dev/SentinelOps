import { pgTable, uuid, pgEnum, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { users } from "./users";
import { teams } from "./teams";

export const teamMemberRoleEnum = pgEnum("team_member_role", ["owner", "member"]);

export const teamMembers = pgTable(
  "team_members",
  {
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: teamMemberRoleEnum("role").notNull().default("member"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.userId] })],
);

export type TeamMember = typeof teamMembers.$inferSelect;
export type NewTeamMember = typeof teamMembers.$inferInsert;
