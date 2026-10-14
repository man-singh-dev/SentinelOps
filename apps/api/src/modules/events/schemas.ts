import { z } from "zod";
export const eventSeverityValues = [
  "critical",
  "high",
  "medium",
  "low",
] as const;

export type EventSeverity = (typeof eventSeverityValues)[number];
export const ingestEventBodySchema = z.object({
  eventId: z
    .string()
    .trim()
    .min(1, "eventId is required")
    .max(255, "eventId must be 255 characters or fewer"),
  eventType: z
    .string()
    .trim()
    .min(1, "eventType is required")
    .max(255, "eventType must be 255 characters or fewer"),
  severity: z.enum(eventSeverityValues),
  message: z
    .string()
    .max(10_000, "message must be 10 000 characters or fewer")
    .optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  timestamp: z
    .string()
    .datetime({ offset: true, message: "timestamp must be a valid ISO-8601 datetime" }),
});

export type IngestEventBody = z.infer<typeof ingestEventBodySchema>;
