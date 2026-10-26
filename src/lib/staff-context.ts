import "server-only";
import { randomInt } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type ActionState = { ok?: boolean; error?: string; message?: string; pin?: string };

// Verifies the caller is active staff (or admin) via their own session before any service-role work.
export async function staffContext(opts: { adminOnly?: boolean } = {}) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Not signed in");
  const { data: profile } = await supabase
    .from("users")
    .select("id, role, facility_id, status")
    .eq("id", auth.user.id)
    .single();
  const allowed = opts.adminOnly ? ["admin"] : ["staff", "admin"];
  if (!profile || profile.status !== "active" || !allowed.includes(profile.role)) throw new Error("Not allowed");
  return { supabase, admin: createAdminClient(), profile };
}

export const randomPin = () => String(randomInt(100000, 1000000));
