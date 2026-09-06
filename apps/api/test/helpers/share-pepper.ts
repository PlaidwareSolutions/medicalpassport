/**
 * Import FIRST in a spec that exercises peppered share-link hashes: the API
 * reads its environment once, at the moment app.module.ts is imported, so
 * the variable has to be in place before that import is evaluated. The
 * CI/e2e command line does not set SHARE_TOKEN_PEPPER (it is optional, and
 * sharing.e2e-spec.ts deliberately runs without it — the V1 bare-hash
 * path), so only the V2 spec opts in.
 */
process.env.SHARE_TOKEN_PEPPER ??= "e2e-share-pepper-not-secret";

export const SHARE_TOKEN_PEPPER = process.env.SHARE_TOKEN_PEPPER;
