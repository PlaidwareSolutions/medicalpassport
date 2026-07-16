import type { Request } from "express";
import type { CaregiverScope } from "@medpass/domain";

/** Request augmented by our middleware/guards. */
export interface ApiRequest extends Request {
  correlationId?: string;
  auth?: {
    userId: string;
    sessionId: string;
    preferredLocale: string;
  };
  profileContext?: {
    profileId: string;
    actorRole: "patient" | "caregiver";
    caregiverScopes: CaregiverScope[];
  };
}
