import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { createLogger } from "@medpass/observability";
import { LogOtpSender, TelnyxSmsSender, TelnyxVoiceOtpSender, type OtpSender } from "@medpass/notifications";
import { env } from "./common/env";
import { PrismaService } from "./common/prisma.service";
import { CorrelationMiddleware } from "./common/correlation.middleware";
import { LoggingInterceptor } from "./common/logging.interceptor";
import { ProblemDetailsFilter } from "./common/problem.filter";
import { AuthGuard } from "./common/auth.guard";
import { RateLimitGuard } from "./common/rate-limit.guard";
import { RateLimitService } from "./common/rate-limit.service";
import { ProfileAccessService } from "./common/profile-access.service";
import { IdempotencyService } from "./common/idempotency.service";
import { HealthController } from "./modules/health/health.controller";
import { MetaController } from "./modules/meta/meta.controller";
import { AuthController } from "./modules/auth/auth.controller";
import { AuthService } from "./modules/auth/auth.service";
import { ProfilesController } from "./modules/profiles/profiles.controller";
import { CaregiversController } from "./modules/caregivers/caregivers.controller";
import { ClaimsController } from "./modules/claims/claims.controller";
import { ConsentsController } from "./modules/consents/consents.controller";
import { CatalogController } from "./modules/catalog/catalog.controller";
import { MedicationsController } from "./modules/medications/medications.controller";
import { MedicationsService } from "./modules/medications/medications.service";
import { SchedulingController } from "./modules/scheduling/scheduling.controller";
import { SchedulingService } from "./modules/scheduling/scheduling.service";
import { TimelineService } from "./modules/scheduling/timeline.service";
import { SafetyController } from "./modules/safety/safety.controller";
import { SafetyEvaluationService } from "./modules/safety/safety-evaluation.service";
import { SharingController } from "./modules/sharing/sharing.controller";
import { SharingService } from "./modules/sharing/sharing.service";
import { VisitSummaryService } from "./modules/sharing/visit-summary.service";
import { VisitSummaryPdfService } from "./modules/sharing/visit-summary-pdf.service";
import { DocumentsController } from "./modules/documents/documents.controller";
import { DocumentsService } from "./modules/documents/documents.service";
import { DevStorageController } from "./modules/documents/dev-storage.controller";
import { ExtractionController } from "./modules/extraction/extraction.controller";
import { ExtractionService } from "./modules/extraction/extraction.service";
import { NotificationsController } from "./modules/notifications/notifications.controller";
import { NotificationsService } from "./modules/notifications/notifications.service";
import { TelnyxWebhookController } from "./modules/notifications/telnyx-webhook.controller";
import { TelnyxVoiceWebhookController } from "./modules/notifications/telnyx-voice-webhook.controller";
import { SyncController } from "./modules/sync/sync.controller";
import { SyncService } from "./modules/sync/sync.service";

export const logger = createLogger("api");

const OTP_SENDER = "OTP_SENDER";

@Module({
  controllers: [
    HealthController,
    MetaController,
    AuthController,
    ProfilesController,
    CaregiversController,
    ClaimsController,
    ConsentsController,
    CatalogController,
    MedicationsController,
    SchedulingController,
    SafetyController,
    SharingController,
    DocumentsController,
    DevStorageController,
    ExtractionController,
    NotificationsController,
    TelnyxWebhookController,
    TelnyxVoiceWebhookController,
    SyncController,
  ],
  providers: [
    PrismaService,
    ProfileAccessService,
    RateLimitService,
    IdempotencyService,
    MedicationsService,
    SchedulingService,
    TimelineService,
    SafetyEvaluationService,
    SharingService,
    VisitSummaryService,
    VisitSummaryPdfService,
    DocumentsService,
    ExtractionService,
    NotificationsService,
    SyncService,
    {
      provide: OTP_SENDER,
      // OTP_TRANSPORT="sms" (docs/16, OD-10 — now unblocked via Telnyx) sends
      // a real OTP over SMS; "voice" (OD-10 supplementary channel) places a
      // real voice call instead; "log" (dev-only, refused in production —
      // see env.ts) simulates the send.
      useValue:
        env().OTP_TRANSPORT === "sms"
          ? new TelnyxSmsSender({
              apiKey: env().TELNYX_API_KEY!,
              fromNumber: env().TELNYX_FROM_NUMBER!,
              webhookUrl: env().TELNYX_WEBHOOK_URL,
            })
          : env().OTP_TRANSPORT === "voice"
            ? new TelnyxVoiceOtpSender({
                apiKey: env().TELNYX_API_KEY!,
                fromNumber: env().TELNYX_FROM_NUMBER!,
                connectionId: env().TELNYX_VOICE_CONNECTION_ID!,
              })
            : new LogOtpSender((obj, msg) => logger.info(obj, msg)),
    },
    {
      provide: AuthService,
      useFactory: (prisma: PrismaService, otpSender: OtpSender) => new AuthService(prisma, otpSender),
      inject: [PrismaService, OTP_SENDER],
    },
    // Rate limiting runs before auth (docs/26: several rate-limited flows —
    // OTP request/verify, public share access — are @Public() and have no
    // session to gate them anyway; guard order matches registration order).
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useValue: new ProblemDetailsFilter(logger) },
    { provide: APP_INTERCEPTOR, useValue: new LoggingInterceptor(logger) },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes("*path");
  }
}
