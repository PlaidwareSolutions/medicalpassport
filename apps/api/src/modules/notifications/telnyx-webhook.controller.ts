import { Controller, Headers, HttpCode, Post, Req } from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import { parseTelnyxDeliveryOutcome, verifyTelnyxWebhookSignature } from "@medpass/notifications";
import { ERROR_CODES } from "@medpass/domain";
import { Public } from "../../common/auth.guard";
import { ApiProblem } from "../../common/errors";
import { env } from "../../common/env";
import type { ApiRequest } from "../../common/http";
import { RateLimit } from "../../common/rate-limit.guard";
import { NotificationsService } from "./notifications.service";

/**
 * Telnyx delivery-status webhook (docs/16 follow-up): the dispatch cron only
 * ever sees Telnyx's synchronous queue-acceptance result, never the async
 * final outcome that arrives here, minutes later, once Telnyx has actually
 * tried the carrier. Unauthenticated by necessity (Telnyx calls this
 * directly, no session) — the Ed25519 signature is the only thing standing
 * between this endpoint and a spoofed delivery report, so it's checked
 * against the raw body before anything else runs. A generous per-IP rate
 * limit (docs/26 lists "webhooks" as a protected flow) adds defense-in-depth
 * against a flood of signature-verification attempts, which cost real CPU
 * even when rejected.
 */
@Controller("webhooks/telnyx")
export class TelnyxWebhookController {
  constructor(private readonly notifications: NotificationsService) {}

  @Public()
  @RateLimit({ name: "telnyx_webhook", limit: 120, windowSeconds: 60 })
  @Post("sms")
  @HttpCode(200)
  async smsDeliveryStatus(
    @Req() req: RawBodyRequest<ApiRequest>,
    @Headers("telnyx-signature-ed25519") signature: string | undefined,
    @Headers("telnyx-timestamp") timestamp: string | undefined,
  ) {
    const publicKey = env().TELNYX_PUBLIC_KEY;
    if (!publicKey) throw new ApiProblem(ERROR_CODES.INTERNAL, "Telnyx webhook not configured", 503);

    if (!signature || !timestamp || !req.rawBody || !verifyTelnyxWebhookSignature(req.rawBody, signature, timestamp, publicKey)) {
      throw new ApiProblem(ERROR_CODES.UNAUTHENTICATED, "Invalid webhook signature", 401);
    }

    const outcome = parseTelnyxDeliveryOutcome(req.body);
    if (outcome) {
      await this.notifications.recordTelnyxDeliveryOutcome(outcome.messageId, outcome.outcome, outcome.errorDigest);
    }
    return { ok: true };
  }
}
