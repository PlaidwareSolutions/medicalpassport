import { Controller, Get, Req } from "@nestjs/common";
import { Public } from "../../common/auth.guard";
import type { ApiRequest } from "../../common/http";
import { FeatureFlagService } from "./feature-flag.service";

const UUID = /^[0-9a-f-]{36}$/i;

@Controller("meta")
export class MetaController {
  constructor(private readonly featureFlags: FeatureFlagService) {}

  /** PWA update checks poll this (docs/14). */
  @Public()
  @Get("version")
  version() {
    return { version: process.env.APP_VERSION ?? "0.1.0-dev" };
  }

  /**
   * docs_v2/05 §14: served from `FeatureFlag` rows with per-profile
   * evaluation (allowlist, percentage rollout by stable hash), falling back
   * to the env-seeded defaults for any key without a row. The optional
   * `x-profile-id` header selects the profile; the route stays public
   * because the PWA asks before it has a session.
   */
  @Public()
  @Get("flags")
  async flags(@Req() req: ApiRequest) {
    const header = req.header("x-profile-id");
    const profileId = header && UUID.test(header) ? header : null;
    return this.featureFlags.evaluateAll(profileId);
  }
}
