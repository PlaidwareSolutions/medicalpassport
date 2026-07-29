import type { Request } from "express";
import type { CaregiverScope } from "@medpass/domain";
import type { AdminDuty } from "@medpass/authorization";

/** Request augmented by our middleware/guards. */
export interface ApiRequest extends Request {
  correlationId?: string;
  auth?: {
    userId: string;
    sessionId: string;
    userDeviceId: string;
    preferredLocale: string;
  };
  profileContext?: {
    profileId: string;
    actorRole: "patient" | "caregiver";
    caregiverScopes: CaregiverScope[];
  };
  adminAuth?: {
    adminUserId: string;
    sessionId: string;
    duties: AdminDuty[];
  };
}
