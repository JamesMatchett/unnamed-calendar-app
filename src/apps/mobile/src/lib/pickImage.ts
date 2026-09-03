import Constants, { ExecutionEnvironment } from "expo-constants";
import * as ImagePicker from "expo-image-picker";
import { Alert, Linking, Platform } from "react-native";

/**
 * Pick a cover image, permissions and all.
 *
 * Shared rather than written per screen: the create form and the calendar
 * settings both need it, and the interesting part is not the picker call but
 * everything around a refusal. Two copies of that drift, which is how one screen
 * ends up explaining itself and the other silently doing nothing.
 *
 * Returns the chosen file URI, or null if nothing was picked. The URI stays
 * local: uploading it is the server's job (§3.4), and the client's job is only
 * to remember which image was chosen.
 */
export async function pickCoverImage(): Promise<string | null> {
  // iOS shows its permission sheet exactly ONCE. After a Deny, every later
  // request resolves as denied with nothing appearing on screen, so asking again
  // gives a button that visibly does nothing. Reading the current state first
  // tells us which case we are in.
  const existing = await ImagePicker.getMediaLibraryPermissionsAsync();
  const permission = existing.canAskAgain
    ? await ImagePicker.requestMediaLibraryPermissionsAsync()
    : existing;

  if (!permission.granted) {
    if (!permission.canAskAgain) explainRefusal();
    // Otherwise the system sheet was just dismissed, and someone who tapped Deny
    // a second ago does not need a dialogue arguing with the choice they made.
    return null;
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsEditing: true,
    aspect: [2, 1],
    quality: 0.8,
  });

  if (result.canceled) return null;
  return result.assets?.[0]?.uri ?? null;
}

/**
 * Linking.openSettings opens "app-settings:", which lands on the app's OWN page
 * in Settings. That is as deep as iOS allows: the only URLs that reach a
 * specific toggle are the private App-Prefs ones, which App Review rejects.
 *
 * Two caveats worth knowing when this looks like it is not working:
 *   - In Expo Go the photo permission belongs to EXPO GO, not to Cal&der, so the
 *     link goes to Expo Go's page. A dev build or TestFlight build shows Cal&der's.
 *   - The page only lists a Photos row once the app has actually asked, and only
 *     if NSPhotoLibraryUsageDescription is set. That string comes from the
 *     expo-image-picker config plugin in app.json.
 *
 * So the message names the exact path rather than leaving someone hunting.
 */
function explainRefusal(): void {
  Alert.alert("Photos access is off", directions(), [
    { text: "Not now", style: "cancel" },
    { text: "Open Settings", onPress: () => void Linking.openSettings() },
  ]);
}

/**
 * In Expo Go the permission belongs to EXPO GO, not to Cal&der: there is no Cal&der
 * entry in Settings to open, so iOS drops you at the top level. Saying "Cal&der's
 * own page" there would be a straightforward lie, and the person would hunt for
 * a row that does not exist. Development builds do not have this problem.
 */
const inExpoGo =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

function directions(): string {
  if (inExpoGo) {
    return "You're running in Expo Go, so the permission belongs to Expo Go rather than Cal&der. In Settings, go to Privacy & Security, then Photos, then Expo Go.";
  }

  return Platform.OS === "ios"
    ? "Settings will open on Cal&der's own page. Tap Photos, then choose Full Access or Limited Access."
    : "Settings will open on Cal&der's own page. Tap Permissions, then Photos and videos, and choose Allow.";
}
