import type { IgModule } from "./common/ig-module.js";
import { UnsupportedIgVersionError } from "./errors.js";
import { ig as v6_5 } from "./ig/v6_5/index.js";
import { ig as v7_0 } from "./ig/v7_0/index.js";

/** Versions with a folder under `src/ig/`. Pins and status live in IG-VERSIONS.md. */
export const SUPPORTED_IG_VERSIONS = ["6.5", "7.0"] as const;
export type IgVersion = (typeof SUPPORTED_IG_VERSIONS)[number];

/** The version the current certification target requires (IG-VERSIONS.md: v6.5.0 is the published IG). */
export const DEFAULT_IG_VERSION: IgVersion = "6.5";

const REGISTRY: Readonly<Record<IgVersion, IgModule>> = Object.freeze({
  "6.5": v6_5,
  "7.0": v7_0,
});

export function isSupportedIgVersion(version: string): version is IgVersion {
  return (SUPPORTED_IG_VERSIONS as readonly string[]).includes(version);
}

/** Selects the IG folder for a version; the only sanctioned way to reach `src/ig/*`. */
export function getIg(version: IgVersion | string): IgModule {
  if (!isSupportedIgVersion(version)) throw new UnsupportedIgVersionError(version);
  return REGISTRY[version];
}

/** Every supported folder, for diff tests that emit the same canonical row in all versions. */
export function allIgs(): readonly IgModule[] {
  return SUPPORTED_IG_VERSIONS.map((v) => REGISTRY[v]);
}
