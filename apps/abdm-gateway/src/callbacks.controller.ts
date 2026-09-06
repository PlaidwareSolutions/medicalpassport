import { randomUUID } from "node:crypto";
import { Body, Controller, Headers, HttpCode, Inject, Post, UnauthorizedException } from "@nestjs/common";
import { GatewayJwtError, type GatewayJwtVerifier } from "./jwt";
import { TRANSACTION_STORE, type GatewayEnv, type TransactionStore } from "./transactions";

export const GATEWAY_JWT_VERIFIER = "GATEWAY_JWT_VERIFIER";
export const GATEWAY_ENV = "GATEWAY_ENV";

/** The ABDM callback body shape we rely on: `requestId` + optional `transactionId`, everything else opaque. */
interface CallbackBody {
  requestId?: string;
  timestamp?: string;
  transactionId?: string;
  resp?: { requestId?: string };
  [key: string]: unknown;
}

/**
 * ABDM gateway callbacks (docs_v2/05 §10; docs_v2/08 §4). Every route: verify the gateway JWT,
 * persist an `AbdmTransaction` (digest only — never the body), enqueue for the worker, answer 202
 * inside the gateway's timeout. Processing never happens in the request.
 *
 * Paths are the v0.5 names the sandbox uses today; a version bump is a new controller, not an edit.
 */
@Controller("v0.5")
export class CallbacksController {
  constructor(
    @Inject(TRANSACTION_STORE) private readonly store: TransactionStore,
    @Inject(GATEWAY_JWT_VERIFIER) private readonly verifier: GatewayJwtVerifier,
    @Inject(GATEWAY_ENV) private readonly gatewayEnv: GatewayEnv,
  ) {}

  @Post("patients/on-find")
  @HttpCode(202)
  onFind(@Body() body: CallbackBody, @Headers("authorization") authorization?: string, @Headers("x-correlation-id") correlationId?: string) {
    return this.accept("patients.on-find", body, authorization, correlationId);
  }

  @Post("links/link/on-init")
  @HttpCode(202)
  onLinkInit(@Body() body: CallbackBody, @Headers("authorization") authorization?: string, @Headers("x-correlation-id") correlationId?: string) {
    return this.accept("links.link.on-init", body, authorization, correlationId);
  }

  @Post("links/link/on-confirm")
  @HttpCode(202)
  onLinkConfirm(@Body() body: CallbackBody, @Headers("authorization") authorization?: string, @Headers("x-correlation-id") correlationId?: string) {
    return this.accept("links.link.on-confirm", body, authorization, correlationId);
  }

  @Post("consents/hiu/notify")
  @HttpCode(202)
  onConsentNotify(@Body() body: CallbackBody, @Headers("authorization") authorization?: string, @Headers("x-correlation-id") correlationId?: string) {
    return this.accept("consents.hiu.notify", body, authorization, correlationId);
  }

  @Post("health-information/hiu/on-request")
  @HttpCode(202)
  onHiRequest(@Body() body: CallbackBody, @Headers("authorization") authorization?: string, @Headers("x-correlation-id") correlationId?: string) {
    return this.accept("health-information.hiu.on-request", body, authorization, correlationId);
  }

  /** The encrypted payload is digested and handed to the worker; decryption + R2 `abdm-inbox` happen there, never in the request. */
  @Post("health-information/transfer")
  @HttpCode(202)
  onTransfer(@Body() body: CallbackBody, @Headers("authorization") authorization?: string, @Headers("x-correlation-id") correlationId?: string) {
    return this.accept("health-information.transfer", body, authorization, correlationId);
  }

  private async accept(kind: string, body: CallbackBody, authorization: string | undefined, correlationId: string | undefined) {
    const token = authorization?.replace(/^Bearer\s+/i, "");
    if (!token) throw new UnauthorizedException("gateway JWT required");
    try {
      this.verifier.verify(token);
    } catch (err) {
      if (err instanceof GatewayJwtError) throw new UnauthorizedException(`gateway JWT rejected: ${err.reason}`);
      throw err;
    }
    const cid = correlationId ?? randomUUID();
    const requestId = typeof body?.requestId === "string" ? body.requestId : null;
    const transactionId = typeof body?.transactionId === "string" ? body.transactionId : null;
    const txn = await this.store.record({ kind, direction: "inbound", requestId, transactionId, correlationId: cid, body }, this.gatewayEnv);
    await this.store.enqueue({
      queue: "abdm_inbound_import",
      jobKey: `abdm:${kind}:${requestId ?? txn.id}`,
      payload: { abdmTransactionId: txn.id, kind, requestId, transactionId, correlationId: cid },
      correlationId: cid,
    });
    return { accepted: true, abdmTransactionId: txn.id, correlationId: cid };
  }
}
