import { Body, Controller, Post, Req } from "@nestjs/common";
import { ERROR_CODES } from "@medpass/domain";
import { syncBatchSchema } from "@medpass/validation";
import { ApiProblem } from "../../common/errors";
import type { ApiRequest } from "../../common/http";
import { parseWith } from "../../common/zod";
import { SyncService } from "./sync.service";

/**
 * Generic offline-mutation sync (docs/15 §Sync flow). Each queued PWA
 * mutation replays here regardless of entity, rather than each carrying its
 * own REST endpoint — SyncService dispatches by entity+operation.
 */
@Controller()
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Post("sync")
  async apply(@Body() body: unknown, @Req() req: ApiRequest) {
    const userId = req.auth?.userId;
    if (!userId) throw new ApiProblem(ERROR_CODES.UNAUTHENTICATED, "Sign in to continue", 401);

    const input = parseWith(syncBatchSchema, body);
    return this.sync.apply(userId, input.mutations, input.cursor, input.profileId, req.correlationId);
  }
}
