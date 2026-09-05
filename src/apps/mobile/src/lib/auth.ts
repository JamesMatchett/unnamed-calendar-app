import { Platform } from "react-native";

import { LOCAL_ONLY } from "@/config";

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

/**
 * Which ways in this device offers.
 *
 * Apple's own rule: an iOS app that offers third-party sign-in must offer Sign
 * in with Apple too, and there is no Sign in with Apple on Android, so the list
 * is per platform rather than a constant.
 */
export const providersFor = (): Provider[] =>
  Platform.OS === "ios" ? ["apple", "google", "email"] : ["google", "email"];

/**
 * Signing in.
 *
 * The seam, and today only the seam: there is no server to hold an account, no
 * OAuth client for Google and no Apple entitlement, so nothing here talks to a
 * provider yet. What it does is settle WHICH provider this person intends to
 * use, record it, and let the alpha carry on locally with a name they type
 * themselves.
 *
 * That is worth having now rather than later for two reasons. The flow is what
 * testers judge, and it is the part that has to feel right before any of it is
 * wired. And when the endpoints land, the change is the body of this function:
 * expo-apple-authentication for one, expo-auth-session for the other, a magic
 * link for the third, each returning the same Account shape the callers already
 * handle. Nothing above this line moves.
 *
 * Returning null means the person backed out, which is not an error.
 */
export async function signIn(provider: Provider): Promise<Account | null> {
  if (LOCAL_ONLY) {
    // No round trip, and no pretending one happened: the provider is noted, and
    // the next step asks for the name a provider would otherwise have given.
    return { provider, displayName: null, email: null };
  }

  // Not reachable while LOCAL_ONLY is true. Left as the shape of the real
  // thing rather than a throw, so the branch is obvious when it is filled in.
  throw new Error(`sign in with ${provider} is not wired up yet`);
}
