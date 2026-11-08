function required(name: string, value: string | undefined) {
  if (!value) throw new Error(`Missing ${name}. Copy mobile/.env.example to mobile/.env.local and fill it in.`);
  return value;
}
// EXPO_PUBLIC_* values are inlined at build time and are visible in the app bundle, so only public values go here.
export const SUPABASE_URL = required("EXPO_PUBLIC_SUPABASE_URL", process.env.EXPO_PUBLIC_SUPABASE_URL);
export const SUPABASE_ANON_KEY = required("EXPO_PUBLIC_SUPABASE_ANON_KEY", process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
export const API_URL = required("EXPO_PUBLIC_API_URL", process.env.EXPO_PUBLIC_API_URL).replace(/\/$/, "");
export const DEFAULT_FACILITY = process.env.EXPO_PUBLIC_DEFAULT_FACILITY ?? "demo-county";
