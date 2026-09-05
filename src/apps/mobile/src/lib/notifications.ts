import type { PlannedReminder } from "@calder/core";
import Constants, { ExecutionEnvironment } from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

/**
 * Getting something onto the lock screen (§7.3).
 *
 * Everything that knows expo-notifications exists lives here.
 *
 * There are two quite different things in this file and it is worth being clear
 * which is which, because only one of them can work today.
 *
 * REMINDERS are local. The phone is told "show this at 6pm on Thursday" and it
 * does, with no server involved, whether or not the app is running. These work
 * now, in Expo Go, and are the whole of what the reminder preference does.
 *
 * NEWS — an invitation, a friend request, somebody adding an event — is
 * ultimately push, and push needs a server that does not exist yet, plus a
 * development build, because remote notifications were removed from Expo Go in
 * SDK 53. Until then the same news is delivered LOCALLY the moment the app
 * notices a new row in its inbox. That is genuinely useful while the app is
 * open and honestly limited when it is not, and it means the delivery point is
 * already written: when the backend lands, a push handler writes the row and
 * everything downstream of it is unchanged.
 */

/** How a notification behaves when it arrives while the app is open. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    // Banner and sound even in the foreground. The alternative, staying silent
    // while the app is open, means a reminder that an event starts in an hour
    // is swallowed precisely because you happened to be looking at the app.
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export type Permission = "granted" | "denied" | "unavailable";

/** Expo Go cannot receive push at all since SDK 53, whatever the permission. */
export const PUSH_AVAILABLE =
  Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;

export async function ensurePermission(): Promise<Permission> {
  if (Platform.OS === "web") return "unavailable";
  try {
    const existing = await Notifications.getPermissionsAsync();
    if (existing.granted) return "granted";
    if (!existing.canAskAgain) return "denied";
    const asked = await Notifications.requestPermissionsAsync();
    return asked.granted ? "granted" : "denied";
  } catch {
    return "unavailable";
  }
}

/** What was already decided, without putting a permission sheet on the screen. */
export async function currentPermission(): Promise<Permission> {
  if (Platform.OS === "web") return "unavailable";
  try {
    return (await Notifications.getPermissionsAsync()).granted ? "granted" : "denied";
  } catch {
    return "unavailable";
  }
}

/**
 * Android shows nothing at all without a channel, and silently: the call to
 * schedule succeeds, and no notification ever appears. Created once at startup
 * rather than per notification, which is what the API expects.
 */
export async function prepareAndroid(): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Reminders and news",
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: "default",
    });
  } catch {
    // A missing channel means quiet notifications, not a broken app.
  }
}

/** Show something now: the local stand-in for a push that has just arrived. */
export async function present(title: string, body: string): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body },
      // Null means immediately. An interval of zero is rejected on iOS.
      trigger: null,
    });
  } catch {
    // Nothing to do and nobody to tell: this is already the telling.
  }
}

/**
 * Replace the whole reminder schedule with this one.
 *
 * Wholesale rather than a diff, deliberately. Working out which of sixty
 * pending notifications to keep, cancel and add is a great deal of bookkeeping
 * to save an operation that takes milliseconds and happens rarely, and the
 * bookkeeping is exactly where a duplicate or a missing reminder would come
 * from. The caller decides WHETHER to reschedule, by comparing signatures; this
 * only does it.
 *
 * Only reminders are cancelled. Anything scheduled for another purpose is left
 * alone, which is why they carry a marker rather than being identified by
 * having been scheduled at all.
 */
export async function rescheduleReminders(
  planned: readonly PlannedReminder[],
): Promise<number> {
  try {
    const existing = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      existing
        .filter((n) => n.content.data?.["calderReminder"] === true)
        .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
    );

    let scheduled = 0;
    for (const reminder of planned) {
      const at = new Date(reminder.fireAt);
      // A moment that has passed between planning and scheduling would fire
      // instantly, which is how somebody gets a notification about an event
      // that started an hour ago the second they open the app.
      if (at.getTime() <= Date.now()) continue;

      await Notifications.scheduleNotificationAsync({
        content: {
          title: reminder.title,
          body: reminder.body,
          data: { calderReminder: true, eventId: reminder.eventId },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: at,
        },
      });
      scheduled += 1;
    }
    return scheduled;
  } catch {
    return 0;
  }
}

/** Everything this app has queued, for the line under the switch. */
export async function scheduledCount(): Promise<number> {
  try {
    const all = await Notifications.getAllScheduledNotificationsAsync();
    return all.filter((n) => n.content.data?.["calderReminder"] === true).length;
  } catch {
    return 0;
  }
}

export async function cancelAllReminders(): Promise<void> {
  await rescheduleReminders([]);
}
