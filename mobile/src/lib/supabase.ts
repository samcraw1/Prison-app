import "react-native-get-random-values";
import { AppState } from "react-native";
import * as SecureStore from "expo-secure-store";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./env";

// Sessions live in the iOS Keychain / Android Keystore. A Supabase session is larger than the ~2 KB some
// iOS versions accept per item, so values are split into chunks.
const CHUNK = 1800;
const opts: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
const safeKey = (key: string) => key.replace(/[^A-Za-z0-9._-]/g, "_");

const secureStorage = {
  async getItem(key: string) {
    const k = safeKey(key);
    const count = await SecureStore.getItemAsync(`${k}.n`, opts);
    if (!count) return null;
    const parts = await Promise.all(Array.from({ length: Number(count) }, (_, i) => SecureStore.getItemAsync(`${k}.${i}`, opts)));
    return parts.some((p) => p === null) ? null : parts.join("");
  },
  async setItem(key: string, value: string) {
    const k = safeKey(key);
    await secureStorage.removeItem(key);
    const parts = value.match(new RegExp(`[\\s\\S]{1,${CHUNK}}`, "g")) ?? [""];
    await Promise.all(parts.map((p, i) => SecureStore.setItemAsync(`${k}.${i}`, p, opts)));
    await SecureStore.setItemAsync(`${k}.n`, String(parts.length), opts);
  },
  async removeItem(key: string) {
    const k = safeKey(key);
    const count = Number((await SecureStore.getItemAsync(`${k}.n`, opts)) ?? 0);
    await Promise.all(Array.from({ length: count }, (_, i) => SecureStore.deleteItemAsync(`${k}.${i}`, opts)));
    await SecureStore.deleteItemAsync(`${k}.n`, opts);
  },
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { storage: secureStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
});

// Only refresh tokens while the app is in the foreground.
AppState.addEventListener("change", (state) => {
  if (state === "active") supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});
