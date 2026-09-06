import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, NotImplementedException, Param, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { InternalTokenGuard } from "./internal.guard";
import { MockGatewayService } from "./mock";
import { TRANSACTION_STORE, type GatewayEnv, type TransactionStore } from "./transactions";
import { GATEWAY_ENV } from "./callbacks.controller";

export const MOCK_GATEWAY = "MOCK_GATEWAY";

const linkInitSchema = z.object({
  method: z.enum(["abha_number", "mobile", "aadhaar_otp"]),
  abhaNumber: z.string().optional(),
  mobile: z.string().optional(),
  aadhaar: z.string().optional(),
  correlationId: z.string().optional(),
});
const linkVerifySchema = z.object({ transactionId: z.string().min(1), otp: z.string().regex(/^\d{6}$/), abhaAddress: z.string().optional(), correlationId: z.string().optional() });
const discoverSchema = z.object({ abhaAddress: z.string().min(1), abhaNumber: z.string().min(1), hipId: z.string().optional(), correlationId: z.string().optional() });
const linkContextsSchema = z.object({
  transactionId: z.string().min(1),
  abhaAddress: z.string().min(1),
  hipId: z.string().min(1),
  patientReferenceNumber: z.string().min(1),
  careContextReferences: z.array(z.string().min(1)).min(1),
  otp: z.string().optional(),
  correlationId: z.string().optional(),
});
const revokeSchema = z.object({ abhaAddress: z.string().optional(), reason: z.string().optional(), correlationId: z.string().optional() });

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new BadRequestException({ code: "validation_failed", issues: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
  return result.data;
}

/**
 * The private API `apps/api` calls (docs_v2/08 §4). Guarded by the shared internal token. In
 * `MOCK=true` every operation replays fixtures; outside mock mode the outbound ABDM client is the
 * next milestone (M8A sandbox onboarding) and answers 501 rather than pretending.
 *
 * Every call is an `AbdmTransaction` (outbound) with the API's correlation id (docs_v2/08 §10).
 */
@Controller("internal")
@UseGuards(InternalTokenGuard)
export class InternalController {
  constructor(
    @Inject(TRANSACTION_STORE) private readonly store: TransactionStore,
    @Inject(MOCK_GATEWAY) private readonly mock: MockGatewayService | null,
    @Inject(GATEWAY_ENV) private readonly gatewayEnv: GatewayEnv,
  ) {}

  @Get("health")
  health() {
    return { ok: true, mock: this.mock !== null, gatewayEnv: this.gatewayEnv };
  }

  @Post("abha/link/init")
  async linkInit(@Body() body: unknown) {
    const input = parse(linkInitSchema, body);
    return this.transact("abha.link.init", input.correlationId, async () => this.requireMock().linkInit(input));
  }

  @Post("abha/link/verify")
  async linkVerify(@Body() body: unknown) {
    const input = parse(linkVerifySchema, body);
    return this.transact("abha.link.verify", input.correlationId, async () => {
      const out = this.requireMock().linkVerify(input);
      if (!out.ok) {
        if (out.reason === "unknown_transaction") throw new NotFoundException({ code: "not_found", title: "Unknown or expired ABHA transaction" });
        throw new BadRequestException({ code: "otp_invalid", title: "Incorrect OTP" });
      }
      const { otp: _otp, ...result } = out.result;
      return result;
    }, input.transactionId);
  }

  @Post("discover")
  async discover(@Body() body: unknown) {
    const input = parse(discoverSchema, body);
    return this.transact("patients.find", input.correlationId, async () => this.requireMock().discover(input));
  }

  @Get("discover/:txnId")
  discoveryResult(@Param("txnId") txnId: string) {
    return this.requireMock().discoveryResult(txnId);
  }

  @Post("care-contexts/link")
  async linkCareContexts(@Body() body: unknown) {
    const input = parse(linkContextsSchema, body);
    return this.transact("links.link.init", input.correlationId, async () => {
      const out = this.requireMock().linkCareContexts(input);
      if (out.status === "otp_invalid") throw new BadRequestException({ code: "otp_invalid", title: "Incorrect OTP" });
      return out;
    }, input.transactionId);
  }

  @Post("consents/:artefactId/revoke")
  async revokeConsent(@Param("artefactId") artefactId: string, @Body() body: unknown) {
    const input = parse(revokeSchema, body ?? {});
    this.requireMock();
    return this.transact("consents.revoke", input.correlationId, async () => ({ status: "revoked" as const, artefactId }));
  }

  /** Decrypted bundle for an `AbdmDataBundle` (mock: the recorded fixture). Real mode reads R2 `abdm-inbox` — next milestone. */
  @Get("bundles/:bundleId/content")
  async bundleContent(@Param("bundleId") bundleId: string) {
    const mock = this.requireMock();
    const txn = await this.store.findByTransactionId(bundleId);
    return mock.bundleContent(txn?.transactionId ?? null);
  }

  private requireMock(): MockGatewayService {
    if (!this.mock) throw new NotImplementedException({ code: "abdm_gateway_not_configured", title: "Outbound ABDM gateway client is not available yet; run with MOCK=true" });
    return this.mock;
  }

  private async transact<T>(kind: string, correlationId: string | undefined, run: () => Promise<T>, transactionId?: string): Promise<T> {
    const txn = await this.store.record({ kind, direction: "outbound", correlationId: correlationId ?? null, transactionId: transactionId ?? null }, this.gatewayEnv);
    try {
      const result = await run();
      const resultTxn = (result as { transactionId?: string } | null)?.transactionId;
      await this.store.complete(txn.id, { status: "completed", responseBody: result });
      if (resultTxn && !transactionId) {
        // Keep the gateway-issued id on the row so callbacks can be correlated to it later.
        await this.store.record({ kind: `${kind}.issued`, direction: "outbound", transactionId: resultTxn, correlationId: correlationId ?? null }, this.gatewayEnv);
      }
      return result;
    } catch (err) {
      const code = typeof err === "object" && err !== null && "response" in err ? String((err as { response?: { code?: string } }).response?.code ?? "gateway_error") : "gateway_error";
      await this.store.complete(txn.id, { status: "failed", errorCode: code, errorText: err instanceof Error ? err.message : "unknown" });
      throw err;
    }
  }
}
