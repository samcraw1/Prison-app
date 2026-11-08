import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { supabase } from "./supabase";

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }),
});

let registeredToken: string | null = null;

async function ensureChannel() {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", { name: "Messages and visits", importance: Notifications.AndroidImportance.HIGH });
  }
}

export async function notificationStatus() {
  return (await Notifications.getPermissionsAsync()).status;
}

// Asks for permission (only when the user taps "Turn on"), then registers this device with the backend.
export async function enablePush(ask: boolean): Promise<"granted" | "denied" | "unavailable"> {
  await ensureChannel();
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted" && ask) status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== "granted") return "denied";
  if (!Device.isDevice) return "unavailable"; // simulators cannot receive remote pushes; local reminders still work
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return "unavailable";
  try {
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    const { error } = await supabase.rpc("register_push_token", { p_token: token, p_platform: Platform.OS === "ios" ? "ios" : "android" });
    if (error) return "unavailable";
    registeredToken = token;
    return "granted";
  } catch {
    return "unavailable";
  }
}

export async function unregisterPush() {
  if (registeredToken) await supabase.rpc("remove_push_token", { p_token: registeredToken });
  registeredToken = null;
}

// Maps a notification's data (type + id only; see the push_outbox migration) to an in-app route.
export function routeForNotification(data: Record<string, unknown> | undefined): string | null {
  if (!data) return null;
  if (data.type === "message" && typeof data.contactId === "string") return `/thread/${data.contactId}`;
  if (data.type === "visit") return "/visits";
  if (data.type === "connection") return "/";
  if (data.type === "wallet") return "/wallet";
  return null;
}

// Local reminder 10 minutes before an approved visit. Scheduled on-device: no server job needed.
const REMINDER_MS = 10 * 60_000;
export async function syncVisitReminders(visits: { id: string; status: string; visit_slots: { starts_at: string } }[]) {
  if ((await Notifications.getPermissionsAsync()).status !== "granted") return;
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const want = new Map(
    visits
      .filter((v) => v.status === "approved" && new Date(v.visit_slots.starts_at).getTime() - REMINDER_MS > Date.now())
      .map((v) => [`visit-${v.id}`, new Date(new Date(v.visit_slots.starts_at).getTime() - REMINDER_MS)]),
  );
  for (const n of scheduled) {
    if (n.identifier.startsWith("visit-") && !want.has(n.identifier)) await Notifications.cancelScheduledNotificationAsync(n.identifier);
  }
  const have = new Set(scheduled.map((n) => n.identifier));
  for (const [identifier, date] of want) {
    if (have.has(identifier)) continue;
    await ensureChannel();
    await Notifications.scheduleNotificationAsync({
      identifier,
      content: { title: "Video visit soon", body: "Your video visit starts in 10 minutes.", data: { type: "visit" } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date, channelId: "default" },
    });
  }
}

// Remember "Not now" on the notification prompt so it doesn't reappear every launch (Account still offers it).
const PROMPT_KEY = "securevisit.pushPromptDismissed";
export async function pushPromptDismissed() {
  const { default: AsyncStorage } = await import("@react-native-async-storage/async-storage");
  return (await AsyncStorage.getItem(PROMPT_KEY)) === "1";
}
export async function dismissPushPrompt() {
  const { default: AsyncStorage } = await import("@react-native-async-storage/async-storage");
  await AsyncStorage.setItem(PROMPT_KEY, "1");
}
