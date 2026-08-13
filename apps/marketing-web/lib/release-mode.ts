/**
 * Production release mode (Session 19).
 *
 * `soft-launch` = a CONTROLLED PRODUCTION SOFT LAUNCH: the site is built for the
 * real production apex (production API/Turnstile/Web-Analytics, apex canonical,
 * English only) BUT keeps a global `noindex` and the draft/under-review legal
 * state. It is deliberately NOT the final indexed public launch — that remains
 * gated on governance (`build:production` + `check:legal`).
 *
 * Distinct from MARKETING_ENV=staging (which serves the draft hi/te/ur locales
 * on staging.medidocs.app with a disallow-all robots.txt). Soft-launch serves
 * only English on the production apex, crawlable-but-noindexed so crawlers can
 * fetch the page and see the noindex directive (§11).
 */
export const RELEASE_MODE = process.env.MARKETING_RELEASE_MODE ?? "";
export const IS_SOFT_LAUNCH = RELEASE_MODE === "soft-launch";
