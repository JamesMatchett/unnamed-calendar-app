import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";

import { LOCAL_ONLY } from "@/config";
import { apiConfig, type ApiConfig } from "@/lib/api";
import { saveSession } from "@/lib/session";

// Closes the authentication sheet when the redirect comes back. Without it the
// sheet stays open behind the app and the promise never settles.
WebBrowser.maybeCompleteAuthSession();

export type Provider = "apple" | "google" | "email";

export interface Account {
  provider: Provider;
  /** What the provider says they are called, when it says. */
  displayName: string | null;
  email: string | null;
}

export const PROVIDER_LABEL: Record<Provider, string> = {
  apple: "Apple",
  google: "Google",
  email: "email",
};

/** Cognito's own names for the providers, which the hosted flow expects. */
const COGNITO_NAME: Partial<Record<Provider, string>> = {
  apple: "SignInWithApple",
  google: "Google",
};

/**
 * How to name a provider read back from storage.
 *
 * The stored value came out of SQLite, written by whichever version of the app
 * was installed at the time, so it is a string rather than a Provider — and a
 * build that once wrote something no longer in the union would otherwise show a
 * blank. Falling back to the raw value keeps an old row readable instead of
 * invisible.
 */
export const providerLabel = (stored: string): string =>
  PROVIDER_LABEL[stored as Provider] ?? stored;

/**
 * Which ways in this device offers, knowing nothing about the server.
 *
 * Apple's own rule: an iOS app that offers third-party sign-in must offer Sign
 * in with Apple too, and there is no Sign in with Apple on Android, so the list
 * is per platform rather than a constant.
 *
 * This is the offline answer. `providersFrom` below narrows it to what is
 * actually configured, which is the difference between offering a button and
 * offering one that works.
 */
export const providersFor = (): Provider[] =>
  Platform.OS === "ios" ? ["apple", "google", "email"] : ["google", "email"];

/**
 * The providers this device can offer AND the server has configured.
 *
 * Ordered by the platform's preference rather than the server's, so Apple stays
 * first on iOS where Apple requires it to be.
 */
export function providersFrom(config: ApiConfig | null): Provider[] {
  if (config === null) return providersFor();
  return providersFor().filter((p) => {
    const name = COGNITO_NAME[p];
    return name !== undefined && config.providers.includes(name);
  });
}

/** A sign-in that did not happen, and whether that is worth saying out loud. */
export class SignInFailed extends Error {
  constructor(readonly detail: string) {
    super(detail);
    this.name = "SignInFailed";
  }
}

/**
 * Signing in.
 *
 * Authorization code with PKCE, through the system authentication sheet. Not a
 * WebView: Apple requires the system sheet for OAuth, and it is also the only
 * thing that will hand the redirect back to the app.
 *
 * `identity_provider` is passed so the sheet goes straight to Apple rather than
 * showing Cognito's own chooser. The chooser is a second screen asking a
 * question the person already answered by tapping a button.
 *
 * Returns null when they backed out, which is not an error. Throws SignInFailed
 * when it genuinely did not work, so the caller can say something rather than
 * silently doing nothing — the two are indistinguishable to somebody looking at
 * an unchanged screen.
 *
 * THE OFFLINE FALLBACK. While LOCAL_ONLY is true the app is fully usable with
 * no server, so being unable to reach one during onboarding should not be a
 * dead end: the provider is recorded and the alpha carries on locally, exactly
 * as it did before any of this existed. Once LOCAL_ONLY is false a failure is a
 * failure, because by then there is data on the other side that a local-only
 * session would quietly not have.
 */
export async function signIn(provider: Provider): Promise<Account | null> {
  const cognitoProvider = COGNITO_NAME[provider];

  const config = await apiConfig();
  if (!config.ok) {
    if (LOCAL_ONLY) return { provider, displayName: null, email: null };
    throw new SignInFailed(`could not reach the server (${config.error.kind})`);
  }

  if (cognitoProvider === undefined || !config.value.providers.includes(cognitoProvider)) {
    throw new SignInFailed(`${PROVIDER_LABEL[provider]} is not set up yet`);
  }

  const { clientId, authDomain } = config.value;
  const discovery: AuthSession.DiscoveryDocument = {
    authorizationEndpoint: `https://${authDomain}/oauth2/authorize`,
    tokenEndpoint: `https://${authDomain}/oauth2/token`,
    revocationEndpoint: `https://${authDomain}/oauth2/revoke`,
  };

  // Must match one of the callback URLs Cognito was given, exactly. In a real
  // build this is calandder://auth; in Expo Go it is an exp:// URL built from
  // the machine's address, which is why the simulator's loopback form is in the
  // allow-list and a physical phone needs a dev client.
  const redirectUri = AuthSession.makeRedirectUri({ scheme: "calandder", path: "auth" });

  const request = new AuthSession.AuthRequest({
    clientId,
    redirectUri,
    responseType: AuthSession.ResponseType.Code,
    scopes: ["openid", "email", "profile"],
    usePKCE: true,
    extraParams: { identity_provider: cognitoProvider },
  });

  const result = await request.promptAsync(discovery);
  if (result.type === "cancel" || result.type === "dismiss") return null;
  if (result.type !== "success") {
    throw new SignInFailed(result.type === "error" ? (result.error?.message ?? "error") : result.type);
  }

  const code = result.params["code"];
  if (code === undefined) throw new SignInFailed("no authorization code came back");

  const tokens = await AuthSession.exchangeCodeAsync(
    {
      clientId,
      code,
      redirectUri,
      // The verifier is what makes the code useless to anybody who intercepted
      // it. Omitting it is the single most common way this flow is made
      // insecure while still appearing to work.
      extraParams: { code_verifier: request.codeVerifier ?? "" },
    },
    discovery,
  );

  if (tokens.idToken === undefined) {
    throw new SignInFailed("no ID token came back, so nothing can identify this session");
  }

  await saveSession({
    idToken: tokens.idToken,
    refreshToken: tokens.refreshToken ?? null,
    expiresAt: Date.now() + (tokens.expiresIn ?? 3600) * 1000,
    provider,
  });

  return { provider, displayName: null, email: null };
}
