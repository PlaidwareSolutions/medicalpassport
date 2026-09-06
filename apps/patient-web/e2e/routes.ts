import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Every patient-web screen the suite can reach deterministically. Dynamic
 * routes ride on the entities the global setup seeded; the ones it can't
 * seed (scan review, share landing, caregiver edit, prescription/report
 * detail) are exercised via their list/new screens instead and noted in
 * docs/22.
 */
export function screenRoutes(): string[] {
  const fixture = JSON.parse(readFileSync(join(__dirname, ".auth/fixture.json"), "utf8")) as {
    medicationId: string;
    /** Present only when the API exposed encounters at seed time (Phase 1 P1-2). */
    encounterId?: string;
  };
  return [
    "/",
    "/add",
    "/add/scan",
    "/allergies",
    "/blood-pressure",
    "/blood-sugar",
    "/body-weight",
    "/caregivers",
    "/caregivers/invitations",
    "/caregivers/new",
    "/conditions",
    "/doctors",
    "/family-history",
    "/health",
    "/health/visits",
    "/health/visits/new",
    ...(fixture.encounterId ? [`/health/visits/${fixture.encounterId}`] : []),
    "/help",
    "/immunizations",
    "/login",
    "/medicines",
    `/medicines/${fixture.medicationId}`,
    `/medicines/${fixture.medicationId}/edit`,
    "/medicines/confirm-type",
    "/offline",
    "/onboarding/profile",
    "/organizations",
    "/prescriptions",
    "/prescriptions/new",
    "/profile",
    "/profile/claim-invitations",
    "/profile/dependents/new",
    "/profile/health-details",
    "/procedures",
    "/reports",
    "/reports/new",
  "/reports/values",
    "/safety",
    "/share",
    "/share/new",
    "/sync/conflicts",
    "/timeline",
    "/tour",
    "/visit",
    "/welcome",
  ];
}
