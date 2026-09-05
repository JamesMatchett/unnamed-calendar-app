import Constants from "expo-constants";
import { Linking, Platform, Share } from "react-native";

/**
 * Where feedback and crash reports go.
 *
 * An alpha exists to produce feedback, and feedback with no channel is a
 * complaint to a friend three days later with the details gone. So there is
 * one address, one row in Settings, and the build details go along
 * automatically so nobody has to be asked "which version".
 */
export const FEEDBACK_EMAIL = "hello@calandder.com";

export function buildLabel(): string {
  const version = Constants.expoConfig?.version ?? "0.0.0";
  const build =
    Platform.OS === "ios"
      ? Constants.expoConfig?.ios?.buildNumber
      : Constants.expoConfig?.android?.versionCode;
  return build ? `${version} (${build})` : version;
}

/**
 * Open the mail app with the build details already in the body; fall back to
 * the share sheet when there is no mail account, which on a test device is
 * not unusual.
 */
export async function sendFeedback(context?: string): Promise<void> {
  const body = [
    "",
    "",
    "---",
    `Cal&der ${buildLabel()} on ${Platform.OS} ${Platform.Version}`,
    context ? `About: ${context}` : null,
  ]
    .filter((line) => line !== null)
    .join("\n");

  const url = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(
    "Cal&der alpha feedback",
  )}&body=${encodeURIComponent(body)}`;

  try {
    if (await Linking.canOpenURL(url)) {
      await Linking.openURL(url);
      return;
    }
    await Share.share({ message: `Feedback for ${FEEDBACK_EMAIL}:${body}` });
  } catch {
    // A dismissed sheet is not a failure.
  }
}

/**
 * Where an unexpected error goes.
 *
 * Today: the console, which in a TestFlight build is nowhere. This is the one
 * seam for a crash reporter: Sentry.captureException(error, { extra }) is a
 * one-line body once there is a DSN, and every caller already goes through
 * here rather than through its own console.error.
 */
export function reportError(error: unknown, extra?: Record<string, unknown>): void {
  console.error("[calder]", error, extra ?? "");
}
