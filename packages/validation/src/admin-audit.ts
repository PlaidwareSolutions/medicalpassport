import { z } from "zod";

export const adminAuditSearchSchema = z.object({
  action: z.string().max(80).optional(),
  actorType: z.enum(["patient", "caregiver", "admin", "system", "share_visitor"]).optional(),
  actorUserId: z.string().uuid().optional(),
  entityType: z.string().max(80).optional(),
  entityId: z.string().uuid().optional(),
  patientProfileId: z.string().uuid().optional(),
  correlationId: z.string().max(120).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  cursor: z.coerce.bigint().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
});
export type AdminAuditSearchInput = z.infer<typeof adminAuditSearchSchema>;
