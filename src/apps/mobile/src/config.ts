/**
 * Build-time facts about THIS build.
 *
 * One file, so a question like "is there a server yet" is answered in one
 * place and never by a screen guessing from a network error.
 */

import Constants from "expo-constants";

/**
 * Whether this build keeps everything on the phone.
 *
 * False now that sync exists: local writes queue in SQLite and drain to the API
 * (src/db/sync.ts), the change feed comes back the other way, and a write that
 * has not been acknowledged is drawn as pending (§5.6) rather than as settled.
 *
 * Kept as a switch rather than deleted, because it is also the honest answer
 * for a build with no environment behind it, and flipping one constant is a
 * better way to ship that than reverting a dozen files.
 */
export const LOCAL_ONLY = false;

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
