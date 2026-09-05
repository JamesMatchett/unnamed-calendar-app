import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * Everything static stays in app.json. This file adds the one thing that cannot
 * be static: which environment this build belongs to.
 *
 * The environment arrives as CALDER_ENV, set per profile in eas.json, and rides
 * into the bundle through `extra`, where Constants.expoConfig.extra can read it
 * at runtime. src/config.ts is the only thing that should read it from there.
 */

const ENVIRONMENTS = ["dev", "staging", "prod"] as const;
type Environment = (typeof ENVIRONMENTS)[number];

/**
 * Hostnames, in source, on purpose.
 *
 * These are the custom domains from src/terraform/modules/api, not the
 * generated execute-api URLs, and that is what makes putting them here safe: an
 * execute-api hostname contains the API's generated id, so recreating the API
 * would strand every build carrying it — and a build sitting in TestFlight is
 * slow to replace. These names survive the API being rebuilt underneath them.
 */
const API_URL: Record<Environment, string> = {
  dev: "https://api.dev.calandder.com",
  staging: "https://api.staging.calandder.com",
  prod: "https://api.calandder.com",
};

function environment(): Environment {
  const raw = process.env.CALDER_ENV;
  // Defaulting to dev rather than prod. A build that forgot to say which
  // environment it is should point at the one where being wrong is cheap.
  if (raw === undefined || raw === "") return "dev";
  if ((ENVIRONMENTS as readonly string[]).includes(raw)) return raw as Environment;
  // Loud, because the alternative is a production build quietly talking to dev.
  throw new Error(
    `CALDER_ENV is "${raw}"; expected one of ${ENVIRONMENTS.join(", ")}.`,
  );
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const env = environment();

  return {
    ...config,
    // ConfigContext gives name and slug as optional; app.json always sets them.
    name: config.name ?? "Cal&der",
    slug: config.slug ?? "calder",
    extra: {
      ...config.extra,
      calderEnvironment: env,
      calderApiUrl: API_URL[env],
    },
  };
};
