import { ERROR_CODES } from "@medpass/domain";
import { decideAdminAccess, type AdminAction } from "@medpass/authorization";
import { ApiProblem } from "./errors";
import type { ApiRequest } from "./http";

/** Throws 403 unless the caller's session carries a duty covering `action`. */
export function requireAdminDuty(req: ApiRequest, action: AdminAction): void {
  if (!decideAdminAccess(req.adminAuth!.duties, action)) {
    throw new ApiProblem(ERROR_CODES.FORBIDDEN, "Your admin account doesn't have permission for this action", 403);
  }
}
