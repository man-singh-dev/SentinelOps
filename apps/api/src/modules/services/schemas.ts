import { z } from "zod";

export const serviceStatusValues = [
  "operational",
  "degraded",
  "partial_outage",
  "major_outage",
  "maintenance",
] as const;

export type ServiceStatus = (typeof serviceStatusValues)[number];
export const createServiceBodySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Service name is required")
    .max(255, "Service name must be 255 characters or fewer"),
  description: z
    .string()
    .trim()
    .max(2000, "Description must be 2000 characters or fewer")
    .optional(),
  status: z.enum(serviceStatusValues).optional(),
  ownerTeamId: z.string().uuid("ownerTeamId must be a valid UUID").optional(),
});

export type CreateServiceBody = z.infer<typeof createServiceBodySchema>;
