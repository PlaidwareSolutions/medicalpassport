import { Controller, Get } from "@nestjs/common";
import { featureFlagsFromEnv } from "@medpass/config";
import { Public } from "../../common/auth.guard";

@Controller("meta")
export class MetaController {
  /** PWA update checks poll this (docs/14). */
  @Public()
  @Get("version")
  version() {
    return { version: process.env.APP_VERSION ?? "0.1.0-dev" };
  }

  @Public()
  @Get("flags")
  flags() {
    return featureFlagsFromEnv();
  }
}
