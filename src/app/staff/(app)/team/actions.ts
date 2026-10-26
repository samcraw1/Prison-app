"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { staffContext, randomPin, type ActionState } from "@/lib/staff-context";

const schema = z.object({
  fullName: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email().max(200),
  role: z.enum(["staff", "admin"]),
});

export async function createStaff(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = schema.safeParse({ fullName: formData.get("fullName"), email: formData.get("email"), role: formData.get("role") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { admin, profile } = await staffContext({ adminOnly: true });

  const tempPassword = `${randomPin()}-${randomPin()}`;
  const { data: created, error } = await admin.auth.admin.createUser({
    email: parsed.data.email, password: tempPassword, email_confirm: true,
    app_metadata: { role: parsed.data.role, facility_id: profile.facility_id },
  });
  if (error || !created.user) return { error: "Could not create that account (is the email already used?)." };
  const { error: insertErr } = await admin.from("users").insert({
    id: created.user.id, facility_id: profile.facility_id, role: parsed.data.role, email: parsed.data.email, full_name: parsed.data.fullName,
  });
  if (insertErr) {
    await admin.auth.admin.deleteUser(created.user.id);
    return { error: "Could not create that account." };
  }
  await admin.rpc("log_action", {
    p_facility: profile.facility_id, p_action: "staff.create", p_entity: "user", p_entity_id: created.user.id,
    p_detail: { email: parsed.data.email, role: parsed.data.role }, p_actor: profile.id,
  });
  revalidatePath("/staff/team");
  return { ok: true, pin: tempPassword, message: `${parsed.data.fullName} was added. Share this temporary password securely.` };
}

export async function setStaffActive(formData: FormData) {
  const id = z.string().uuid().parse(formData.get("userId"));
  const active = formData.get("active") === "true";
  const { admin, profile, supabase } = await staffContext({ adminOnly: true });
  if (id === profile.id) return; // admins cannot lock themselves out
  const { data: target } = await supabase.from("users").select("id, role").eq("id", id).in("role", ["staff", "admin"]).single();
  if (!target) return;
  await admin.from("users").update({ status: active ? "active" : "suspended" }).eq("id", id);
  await admin.auth.admin.updateUserById(id, { ban_duration: active ? "none" : "876000h" });
  await admin.rpc("log_action", {
    p_facility: profile.facility_id, p_action: active ? "staff.activate" : "staff.deactivate", p_entity: "user", p_entity_id: id,
    p_detail: {}, p_actor: profile.id,
  });
  revalidatePath("/staff/team");
}
