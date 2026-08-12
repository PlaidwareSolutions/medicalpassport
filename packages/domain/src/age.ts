/**
 * Age helpers for the children/guardian policy (children V1).
 *
 * The product stores only YEAR of birth (data minimization), so age can only be
 * bounded, not known exactly. `age = currentYear - yearOfBirth` is the person's
 * age reached (or to be reached) during the current calendar year. We treat
 * `age < MINOR_AGE` as a minor. Because we lack the birth month/day, someone
 * turning 18 during the year is treated as an adult for that year — a documented
 * V1 approximation; a stricter, verifiable check is designed for the DPDP
 * child-consent commencement (see docs/landing-page/children-guardian-remediation-design.md).
 */
export const MINOR_AGE = 18;

export function computeAgeFromBirthYear(yearOfBirth: number, now: Date = new Date()): number {
  return now.getUTCFullYear() - yearOfBirth;
}

/** True when the given birth year indicates a person under 18 this calendar year. */
export function isMinorByBirthYear(yearOfBirth: number, now: Date = new Date()): boolean {
  return computeAgeFromBirthYear(yearOfBirth, now) < MINOR_AGE;
}
