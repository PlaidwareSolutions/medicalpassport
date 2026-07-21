import { Controller, Headers, HttpCode, Post, Req } from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import { buildVoiceOtpSpeech, parseTelnyxCallEvent, telnyxHangup, telnyxSpeak, verifyTelnyxWebhookSignature } from "@medpass/notifications";
import { ERROR_CODES } from "@medpass/domain";
import { Public } from "../../common/auth.guard";
import { ApiProblem } from "../../common/errors";
import { env } from "../../common/env";
import type { ApiRequest } from "../../common/http";
import { RateLimit } from "../../common/rate-limit.guard";

/**
 * Telnyx Call Control webhook for voice OTP (docs/16, OD-10 supplementary
 * channel). Call answering is asynchronous — Telnyx accepts the "place a
 * call" request immediately, but the recipient might pick up seconds or
 * tens of seconds later — so the actual "speak the code" and "hang up"
 * commands can only be issued from here, in reaction to `call.answered`
 * and `call.speak.ended` respectively. Unauthenticated by necessity (Telnyx
 * calls this directly, no session) — same Ed25519 signature scheme and
 * verification helper as the SMS delivery-status webhook.
 */
@Controller("webhooks/telnyx")
export class TelnyxVoiceWebhookController {
  @Public()
  @RateLimit({ name: "telnyx_voice_webhook", limit: 120, windowSeconds: 60 })
  @Post("voice")
  @HttpCode(200)
  async callEvent(
    @Req() req: RawBodyRequest<ApiRequest>,
    @Headers("telnyx-signature-ed25519") signature: string | undefined,
    @Headers("telnyx-timestamp") timestamp: string | undefined,
  ) {
    const publicKey = env().TELNYX_PUBLIC_KEY;
    const apiKey = env().TELNYX_API_KEY;
    if (!publicKey || !apiKey) throw new ApiProblem(ERROR_CODES.INTERNAL, "Telnyx voice webhook not configured", 503);

    if (!signature || !timestamp || !req.rawBody || !verifyTelnyxWebhookSignature(req.rawBody, signature, timestamp, publicKey)) {
      throw new ApiProblem(ERROR_CODES.UNAUTHENTICATED, "Invalid webhook signature", 401);
    }

    const event = parseTelnyxCallEvent(req.body);
    if (!event) return { ok: true };

    if (event.eventType === "call.answered" && event.clientState) {
      const { payload, language } = buildVoiceOtpSpeech(event.clientState.code, event.clientState.locale);
      await telnyxSpeak(apiKey, event.callControlId, payload, language);
    } else if (event.eventType === "call.speak.ended") {
      await telnyxHangup(apiKey, event.callControlId);
    }
    // Other events (call.initiated, call.hangup, call.machine.*, etc.) —
    // nothing to do; the voice OTP flow doesn't act on them.

    return { ok: true };
  }
}
