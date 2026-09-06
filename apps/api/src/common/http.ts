import type { Request } from "express";
import type { CaregiverScope } from "@medpass/domain";
import type { AdminDuty } from "@medpass/authorization";

/** Request augmented by our middleware/guards. */
export interface ApiRequest extends Request {
  correlationId?: string;
  /**
   * Set by LoggingInterceptor once it has attached its `finish` logger.
   * Guards run before interceptors, so a guard rejection (401/403/429)
   * never reaches the interceptor; ProblemDetailsFilter logs those itself
   * when this flag is absent (docs_v2 ticket 0.20 finding).
   */
  requestLogAttached?: boolean;
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
