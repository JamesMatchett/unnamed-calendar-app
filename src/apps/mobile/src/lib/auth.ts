import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";

import { LOCAL_ONLY } from "@/config";
import { apiConfig, me, type ApiConfig } from "@/lib/api";
import { clearSession, loadSession, saveSession } from "@/lib/session";

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

  // Logged because this is the one value that fails invisibly. Cognito matches
  // callback URLs exactly and, when none matches, shows a page saying only "An
  // error was encountered with the requested page" — no parameter, no name, no
  // clue which end is wrong. Knowing the string the app actually sent turns
  // that into a one-line fix.
  if (__DEV__) console.log(`[auth] redirect_uri = ${redirectUri}`);

  const request = new AuthSession.AuthRequest({
    clientId,
    redirectUri,
    responseType: AuthSession.ResponseType.Code,
    scopes: ["openid", "email", "profile"],
    usePKCE: true,
    extraParams: { identity_provider: cognitoProvider },
  });

  // A PRIVATE authentication session: the web view that opens Cognito does not
  // share Safari's cookie jar.
  //
  // Signing out is the reason. Cognito sets its own session cookie on the
  // hosted domain, and nothing this app can run reaches it — fetch has its own
  // cookie store, so revoking the refresh token and clearing the Keychain
  // leaves that cookie alive. Sign out, sign back in, and Cognito recognises
  // the still-live session and returns a token without Apple being asked
  // anything. Somebody who hands their phone over after signing out would find
  // that surprising, and they would be right.
  //
  // It also removes iOS's "wants to use amazoncognito.com to sign in" consent
  // prompt, which is not a cosmetic win so much as the honest consequence:
  // that prompt is asking permission for the cookie sharing this turns off.
  //
  // What it costs is single sign-on from Safari, which is worth close to
  // nothing here: Sign in with Apple authenticates against the system account
  // through the native sheet, not a browser cookie. It would start to matter
  // if an email-and-password provider is ever added, where a live browser
  // session saves real typing.
  const result = await request.promptAsync(discovery, {
    preferEphemeralSession: true,
  });
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

  // Ask the API rather than reading the token here. It costs one request and
  // buys two things: the claims come back having been verified by the
  // authoriser, and a token that will not work is discovered now, during a
  // sign-in somebody is watching, instead of later during something they are
  // not.
  //
  // A failure is not fatal. They are signed in; we simply do not know their
  // name, which is the same state as Apple declining to send one, and the next
  // screen asks.
  const profile = await me(tokens.idToken);

  // The response, not the token. Cognito holds the name on the user, so if it
  // is null here the claim is not reaching the ID token; if it is present here
  // the loss is further up, in the screen. Nothing secret: a name and a relay
  // address the person just typed into Apple's own sheet.
  if (__DEV__) console.log(`[auth] me = ${JSON.stringify(profile)}`);

  return {
    provider,
    displayName: profile.ok ? profile.value.name : null,
    email: profile.ok ? profile.value.email : null,
  };
}

/**
 * Signing out.
 *
 * Two halves, and only one of them can fail. Cognito is asked to revoke the
 * refresh token, which is what stops it being usable by anyone who has a copy;
 * `enable_token_revocation` on the client is what makes that request mean
 * something. Then the Keychain is cleared, which is what stops it being usable
 * here.
 *
 * The revoke is best effort ON PURPOSE. Somebody signing out on a train has to
 * end up signed out, and a network error must not leave the token sitting in
 * the Keychain because a request failed. Clearing locally always happens; the
 * revoke is the part that also protects a token already exfiltrated, which is
 * the rarer case.
 *
 * The ID token is not revoked because it cannot be: it is valid until it
 * expires, an hour at most, and nothing can recall it. That is the trade the
 * whole design makes by validating tokens at the gateway rather than looking
 * them up.
 */
export async function signOut(): Promise<void> {
  const session = await loadSession();

  if (session?.refreshToken != null) {
    try {
      const config = await apiConfig();
      if (config.ok) {
        await fetch(`https://${config.value.authDomain}/oauth2/revoke`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            token: session.refreshToken,
            client_id: config.value.clientId,
          }).toString(),
        });
      }
    } catch {
      // Offline, or Cognito unreachable. The local half below still runs.
    }
  }

  await clearSession();
}
