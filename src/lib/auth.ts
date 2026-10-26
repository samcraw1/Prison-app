import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Role = "family" | "resident" | "staff" | "admin";

export const HOME: Record<Role, string> = {
  family: "/family",
  resident: "/resident",
  staff: "/staff",
  admin: "/staff",
};

export const LOGIN: Record<Role, string> = {
  family: "/family/login",
  resident: "/resident/login",
  staff: "/staff/login",
  admin: "/staff/login",
};

// Server-side guard used by each role's layout. RLS is the real enforcement; this is UX.
export async function requireRole(allowed: Role[]) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect(LOGIN[allowed[0]]);

  const { data: profile } = await supabase
    .from("users")
    .select("id, role, facility_id, full_name, email, status")
    .eq("id", auth.user.id)
    .single();

  if (!profile || profile.status !== "active") redirect(LOGIN[allowed[0]]);
  if (!allowed.includes(profile.role as Role)) redirect(HOME[profile.role as Role]);
  return { supabase, profile: { ...profile, role: profile.role as Role } };
}
