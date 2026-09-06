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
import { AdminAuthGuard } from "./common/admin-auth.guard";
import { RateLimitGuard } from "./common/rate-limit.guard";
import { RateLimitService } from "./common/rate-limit.service";
import { ProfileAccessService } from "./common/profile-access.service";
import { IdempotencyService } from "./common/idempotency.service";
import { HealthController } from "./modules/health/health.controller";
import { MetaController } from "./modules/meta/meta.controller";
import { AuthController } from "./modules/auth/auth.controller";
import { AuthService } from "./modules/auth/auth.service";
import { AdminAuthController } from "./modules/admin-auth/admin-auth.controller";
import { AdminAuthService } from "./modules/admin-auth/admin-auth.service";
import { AdminCatalogController } from "./modules/admin-catalog/admin-catalog.controller";
import { AdminCatalogChangesController } from "./modules/admin-catalog/admin-catalog-changes.controller";
import { AdminCatalogChangesService } from "./modules/admin-catalog/admin-catalog-changes.service";
import { AdminContentController } from "./modules/admin-content/admin-content.controller";
import { AdminContentService } from "./modules/admin-content/admin-content.service";
import { AdminAuditController } from "./modules/admin-audit/admin-audit.controller";
import { AdminIncidentsController } from "./modules/admin-incidents/admin-incidents.controller";
import { AdminIncidentsService } from "./modules/admin-incidents/admin-incidents.service";
import { AdminOperationsController } from "./modules/admin-operations/admin-operations.controller";
import { AdminUsersController } from "./modules/admin-users/admin-users.controller";
import { AdminOrganizationsController } from "./modules/admin-providers/admin-organizations.controller";
import { AdminRulesController } from "./modules/admin-rules/admin-rules.controller";
import { AdminRulesQualityController } from "./modules/admin-rules/admin-rules-quality.controller";
import { ProfilesController } from "./modules/profiles/profiles.controller";
import { GlucoseController } from "./modules/glucose/glucose.controller";
import { VitalsController } from "./modules/vitals/vitals.controller";
import { CaregiversController } from "./modules/caregivers/caregivers.controller";
import { ClaimsController } from "./modules/claims/claims.controller";
import { ConsentsController } from "./modules/consents/consents.controller";
import { CatalogController } from "./modules/catalog/catalog.controller";
import { ClinicalContentLookupService } from "./modules/clinical-content/clinical-content-lookup.service";
import { MedicationsController } from "./modules/medications/medications.controller";
import { MedicationsService } from "./modules/medications/medications.service";
import { PractitionersController } from "./modules/practitioners/practitioners.controller";
import { PractitionersService } from "./modules/practitioners/practitioners.service";
import { PrescriptionsController } from "./modules/prescriptions/prescriptions.controller";
import { PrescriptionsService } from "./modules/prescriptions/prescriptions.service";
import { DiagnosticsController, TerminologyController } from "./modules/diagnostics/diagnostics.controller";
import { DiagnosticsService } from "./modules/diagnostics/diagnostics.service";
import { ObservationsController, ObservationTerminologyController } from "./modules/observations/observations.controller";
import { ObservationsService } from "./modules/observations/observations.service";
import { ReportsController } from "./modules/reports/reports.controller";
import { ReportsService } from "./modules/reports/reports.service";
import { SchedulingController } from "./modules/scheduling/scheduling.controller";
import { SchedulingService } from "./modules/scheduling/scheduling.service";
import { TimelineService } from "./modules/scheduling/timeline.service";
import { SafetyController } from "./modules/safety/safety.controller";
import { SafetyEvaluationService } from "./modules/safety/safety-evaluation.service";
import { SharingController } from "./modules/sharing/sharing.controller";
import { SharingService } from "./modules/sharing/sharing.service";
import { VisitSummaryService } from "./modules/sharing/visit-summary.service";
import { DoctorSnapshotService } from "./modules/sharing/doctor-snapshot.service";
import { FamilyService } from "./modules/caregivers/family.service";
import { LeadsController } from "./modules/leads/leads.controller";
import { LeadsService } from "./modules/leads/leads.service";
import { VisitSummaryPdfService } from "./modules/sharing/visit-summary-pdf.service";
import { DocumentsController } from "./modules/documents/documents.controller";
import { DocumentsService } from "./modules/documents/documents.service";
import { DevStorageController } from "./modules/documents/dev-storage.controller";
import { ExtractionController } from "./modules/extraction/extraction.controller";
import { ExtractionService } from "./modules/extraction/extraction.service";
import { DocumentsV2Controller } from "./modules/documents-v2/documents-v2.controller";
import { DocumentsV2Service } from "./modules/documents-v2/documents-v2.service";
import { DocumentExtractionsController } from "./modules/documents-v2/document-extractions.controller";
import { DocumentExtractionsService } from "./modules/documents-v2/document-extractions.service";
import { NotificationsController } from "./modules/notifications/notifications.controller";
import { NotificationsService } from "./modules/notifications/notifications.service";
import { TelnyxWebhookController } from "./modules/notifications/telnyx-webhook.controller";
import { TelnyxVoiceWebhookController } from "./modules/notifications/telnyx-voice-webhook.controller";
import { SyncController } from "./modules/sync/sync.controller";
import { SyncService } from "./modules/sync/sync.service";
import { ClinicalProfileController } from "./modules/clinical-profile/clinical-profile.controller";
import { ClinicalProfileService } from "./modules/clinical-profile/clinical-profile.service";
import { OrganizationsController } from "./modules/organizations/organizations.controller";
import { OrganizationsService } from "./modules/organizations/organizations.service";
import { EncountersController } from "./modules/encounters/encounters.controller";
import { EncountersService } from "./modules/encounters/encounters.service";
import { HealthTimelineController } from "./modules/timeline/health-timeline.controller";
import { HealthTimelineService } from "./modules/timeline/health-timeline.service";
import { ProviderGuard } from "./modules/providers/provider.guard";
import { ProviderAuthController } from "./modules/providers/provider-auth.controller";
import { ProviderAuthService } from "./modules/providers/provider-auth.service";
import { ProviderOrganizationsController } from "./modules/providers/provider-organizations.controller";
import { ProviderOrganizationsService } from "./modules/providers/provider-organizations.service";
import { PatientLinksController } from "./modules/providers/patient-links.controller";
import { PatientLinksService } from "./modules/providers/patient-links.service";
import { ProviderPatientsController } from "./modules/providers/provider-patients.controller";
import { ProposalsService } from "./modules/proposals/proposals.service";
import { ProposalApplyService } from "./modules/proposals/proposal-apply.service";
import { ProviderProposalsController } from "./modules/proposals/provider-proposals.controller";
import { ProposalsController } from "./modules/proposals/proposals.controller";
import { OpenApiController } from "./openapi/openapi.controller";
import { FeatureFlagService } from "./modules/meta/feature-flag.service";
import { TestDueController } from "./modules/test-due/test-due.controller";
import { TestDueService } from "./modules/test-due/test-due.service";
import { AdminFlagsController } from "./modules/admin-platform/admin-flags.controller";
import { AdminSupportCasesController } from "./modules/admin-platform/admin-support-cases.controller";
import { AdminBreakGlassController } from "./modules/admin-platform/admin-break-glass.controller";
import { BreakGlassService } from "./modules/admin-platform/break-glass.service";
import { AdminConsentAuditController } from "./modules/admin-platform/admin-consent-audit.controller";
import { AdminDocumentsStatusController } from "./modules/admin-platform/admin-documents-status.controller";
import { AdminAbdmTransactionsController } from "./modules/admin-platform/admin-abdm-transactions.controller";
import { AdminFhirFailuresController } from "./modules/admin-platform/admin-fhir-failures.controller";
import { AdminIntegrationsController } from "./modules/admin-platform/admin-integrations.controller";
import { AdminNotificationFailuresController } from "./modules/admin-platform/admin-notification-failures.controller";
import { FhirController } from "./modules/fhir/fhir.controller";
import { FhirExportService } from "./modules/fhir/fhir-export.service";
import { AbdmController } from "./modules/abdm/abdm.controller";
import { AbdmService } from "./modules/abdm/abdm.service";
import { AbdmImportService } from "./modules/abdm/abdm-import.service";
import { ABDM_GATEWAY_CLIENT, HttpAbdmGatewayClient, MockAbdmGatewayClient, type AbdmGatewayClient } from "./modules/abdm/gateway-client";
// V2 Phase 10 (docs_v2/06 P10): the treatment journey — relationship edges, before/after views, condition hub.
import { JourneyController } from "./modules/journey/journey.controller";
import { JourneyService } from "./modules/journey/journey.service";
import { ClinicalRelationshipsService } from "./modules/journey/clinical-relationships.service";
// Phase 0 tickets 0.18 / 0.19: deferred read-path audit queue; origin security headers.
import { HttpAdapterHost } from "@nestjs/core";
import { AuditQueueService } from "./common/audit-queue.service";
import { securityHeaders } from "./common/security-headers";
// docs_v2/06 P1-7: PHI-free product metrics — buffered emitter and the admin aggregate.
import { ProductEventsService } from "./modules/product-events/product-events.service";
import { AdminMetricsController } from "./modules/admin-metrics/admin-metrics.controller";

export const logger = createLogger("api");

const OTP_SENDER = "OTP_SENDER";

@Module({
  controllers: [
    HealthController,
    MetaController,
    AuthController,
    AdminAuthController,
    AdminCatalogController,
    AdminCatalogChangesController,
    AdminContentController,
    AdminAuditController,
    AdminIncidentsController,
    AdminOperationsController,
    AdminUsersController,
    AdminOrganizationsController,
    AdminRulesController,
    AdminRulesQualityController,
    ProfilesController,
    GlucoseController,
    VitalsController,
    CaregiversController,
    ClaimsController,
    ConsentsController,
    CatalogController,
    MedicationsController,
    PractitionersController,
    PrescriptionsController,
    ReportsController,
    DiagnosticsController,
    TerminologyController,
    ObservationsController,
    ObservationTerminologyController,
    SchedulingController,
    SafetyController,
    SharingController,
    LeadsController,
    DocumentsController,
    DevStorageController,
    ExtractionController,
    DocumentsV2Controller,
    DocumentExtractionsController,
    NotificationsController,
    TelnyxWebhookController,
    TelnyxVoiceWebhookController,
    SyncController,
    ClinicalProfileController,
    OrganizationsController,
    OpenApiController,
    EncountersController,
    HealthTimelineController,
    ProviderAuthController,
    ProviderOrganizationsController,
    PatientLinksController,
    ProviderPatientsController,
    ProviderProposalsController,
    ProposalsController,
    FhirController,
    AbdmController,
    // V2 Phase 17 + admin platform (docs_v2/05 §12–§14, docs_v2/14 §3).
    TestDueController,
    AdminFlagsController,
    AdminSupportCasesController,
    AdminBreakGlassController,
    AdminConsentAuditController,
    AdminDocumentsStatusController,
    AdminAbdmTransactionsController,
    AdminFhirFailuresController,
    AdminIntegrationsController,
    AdminNotificationFailuresController,
    JourneyController,
    AdminMetricsController,
  ],
  providers: [
    PrismaService,
    ProfileAccessService,
    RateLimitService,
    IdempotencyService,
    AdminAuthGuard,
    AdminAuthService,
    AdminCatalogChangesService,
    AdminContentService,
    AdminIncidentsService,
    ClinicalContentLookupService,
    MedicationsService,
    PractitionersService,
    PrescriptionsService,
    ReportsService,
    DiagnosticsService,
    ObservationsService,
    SchedulingService,
    TimelineService,
    SafetyEvaluationService,
    SharingService,
    LeadsService,
    VisitSummaryService,
    DoctorSnapshotService,
    FamilyService,
    VisitSummaryPdfService,
    DocumentsService,
    ExtractionService,
    DocumentsV2Service,
    DocumentExtractionsService,
    NotificationsService,
    SyncService,
    ClinicalProfileService,
    OrganizationsService,
    EncountersService,
    HealthTimelineService,
    ProviderGuard,
    ProviderAuthService,
    ProviderOrganizationsService,
    PatientLinksService,
    ProposalsService,
    ProposalApplyService,
    FhirExportService,
    AbdmService,
    AbdmImportService,
    FeatureFlagService,
    TestDueService,
    BreakGlassService,
    ClinicalRelationshipsService,
    JourneyService,
    ProductEventsService,
    {
      // docs_v2/08 §4/§9: the API talks to apps/abdm-gateway's private API; with no
      // ABDM_GATEWAY_URL an in-process mock replays sandbox fixtures (local, CI).
      provide: ABDM_GATEWAY_CLIENT,
      useFactory: (): AbdmGatewayClient => {
        const e = env();
        if (!e.ABDM_GATEWAY_URL) return new MockAbdmGatewayClient();
        if (!e.ABDM_INTERNAL_TOKEN) throw new Error("ABDM_GATEWAY_URL requires ABDM_INTERNAL_TOKEN");
        return new HttpAbdmGatewayClient(e.ABDM_GATEWAY_URL.replace(/\/$/, ""), e.ABDM_INTERNAL_TOKEN, e.ABDM_GATEWAY_ENV);
      },
    },
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
    // Ticket 0.18: routes the deferred audit queue's batch/failure logs to
    // pino and drains the queue on app.close() (see also PrismaService).
    { provide: AuditQueueService, useValue: new AuditQueueService(logger) },
  ],
})
export class AppModule implements NestModule {
  constructor(private readonly adapterHost: HttpAdapterHost) {}

  configure(consumer: MiddlewareConsumer): void {
    // Ticket 0.19: bound to the Express app itself, ahead of every route,
    // rather than through `consumer.forRoutes("*path")` — that pattern only
    // covers `/v1/*` plus the excluded health paths, so a 404 outside the
    // prefix would go out bare. Same effect as the former `app.use` in
    // main.ts, now also exercised by the e2e harness.
    this.adapterHost.httpAdapter.getInstance().use(securityHeaders);
    consumer.apply(CorrelationMiddleware).forRoutes("*path");
  }
}
