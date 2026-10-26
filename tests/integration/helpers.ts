import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
export const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

export async function signIn(email: string, password: string): Promise<SupabaseClient> {
  const c = createClient(url, anon, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign in ${email}: ${error.message}`);
  return c;
}

export const PASSWORD = "DemoPass!234";
export const PIN = "123456";
export const asStaff = () => signIn("staff@demo-county.test", PASSWORD);
export const asFamily = (n: number) => signIn(`family${n}@example.test`, PASSWORD);
export const asResident = (booking: string) => signIn(`${booking.toLowerCase()}@residents.kinline.test`, PIN);

export async function userId(c: SupabaseClient) {
  return (await c.auth.getUser()).data.user!.id;
}
export async function facilityId() {
  const { data } = await admin.from("facilities").select("id").eq("slug", "demo-county").single();
  return data!.id as string;
}
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
export const tinyPng = () => new Blob([PNG], { type: "image/png" });
