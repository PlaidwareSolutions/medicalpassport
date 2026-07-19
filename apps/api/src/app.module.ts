import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { createLogger } from "@medpass/observability";
import { LogOtpSender, TelnyxSmsSender, type OtpSender } from "@medpass/notifications";
import { env } from "./common/env";
import { PrismaService } from "./common/prisma.service";
import { CorrelationMiddleware } from "./common/correlation.middleware";
import { LoggingInterceptor } from "./common/logging.interceptor";
import { ProblemDetailsFilter } from "./common/problem.filter";
import { AuthGuard } from "./common/auth.guard";
import { ProfileAccessService } from "./common/profile-access.service";
import { IdempotencyService } from "./common/idempotency.service";
import { HealthController } from "./modules/health/health.controller";
import { MetaController } from "./modules/meta/meta.controller";
import { AuthController } from "./modules/auth/auth.controller";
import { AuthService } from "./modules/auth/auth.service";
import { ProfilesController } from "./modules/profiles/profiles.controller";
import { CaregiversController } from "./modules/caregivers/caregivers.controller";
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
    SyncController,
  ],
  providers: [
    PrismaService,
    ProfileAccessService,
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
      // a real OTP; "log" (dev-only, refused in production — see env.ts)
      // simulates the send instead.
      useValue:
        env().OTP_TRANSPORT === "sms"
          ? new TelnyxSmsSender({ apiKey: env().TELNYX_API_KEY!, fromNumber: env().TELNYX_FROM_NUMBER! })
          : new LogOtpSender((obj, msg) => logger.info(obj, msg)),
    },
    {
      provide: AuthService,
      useFactory: (prisma: PrismaService, otpSender: OtpSender) => new AuthService(prisma, otpSender),
      inject: [PrismaService, OTP_SENDER],
    },
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
