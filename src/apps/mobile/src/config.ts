/**
 * Build-time facts about THIS build.
 *
 * One file, so a question like "is there a server yet" is answered in one
 * place and never by a screen guessing from a network error.
 */

import Constants from "expo-constants";

/**
 * The alpha keeps everything on the phone. There is no server to talk to, so
 * every local write would otherwise sit at 'pending' forever, greyed out with
 * a spinner that never stops: to a tester that reads as broken, not as
 * offline. While this is true the app draws local writes as settled and says
 * so, once, in Settings.
 *
 * Flip it when sync lands. Nothing in the data model changes either way: writes
 * are still queued, so the day a server exists they go.
 *
 * Note this is NOT the same question as whether there is an API. There is one,
 * and ENVIRONMENT below says which; what there is not yet is a way to sign in
 * to it, so nothing but the health check has anywhere to go.
 */
export const LOCAL_ONLY = true;

/** Where the app lives on the web. The domain is the one machine-safe name. */
export const SITE = "https://calandder.com";

export type Environment = "dev" | "staging" | "prod";

interface CalderExtra {
  calderEnvironment?: string;
  calderApiUrl?: string;
}

const extra = (Constants.expoConfig?.extra ?? {}) as CalderExtra;

/**
 * Which environment this build belongs to.
 *
 * Set by app.config.ts from CALDER_ENV, which eas.json sets per build profile.
 * Falling back to dev rather than prod is deliberate: a build that has somehow
 * lost its configuration should point at the environment where being wrong is
 * cheap, not the one with other people's data in it.
 */
export const ENVIRONMENT: Environment =
  extra.calderEnvironment === "prod"
    ? "prod"
    : extra.calderEnvironment === "staging"
      ? "staging"
      : "dev";

/** Base URL of the API this build talks to. No trailing slash. */
export const API_BASE: string =
  extra.calderApiUrl ?? "https://api.dev.calandder.com";
