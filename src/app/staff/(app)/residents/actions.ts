"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { staffContext, randomPin, type ActionState } from "@/lib/staff-context";

const intakeSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  booking: z.string().trim().regex(/^[A-Za-z0-9-]{3,20}$/, "Booking number: letters, numbers and dashes (3-20)"),
  housingUnit: z.string().trim().max(20).optional(),
});

export async function createResident(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = intakeSchema.safeParse({
    fullName: formData.get("fullName"),
    booking: formData.get("booking"),
    housingUnit: formData.get("housingUnit") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const { admin, profile } = await staffContext();
  const pin = randomPin();
  const email = `${crypto.randomUUID()}@residents.kinline.invalid`;

  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password: pin,
    email_confirm: true,
    app_metadata: { role: "resident", facility_id: profile.facility_id },
  });
  if (error || !created.user) return { error: "Could not create the resident account." };

  const uid = created.user.id;
  const rollback = () => admin.auth.admin.deleteUser(uid);
  const { error: userErr } = await admin.from("users").insert({
    id: uid, facility_id: profile.facility_id, role: "resident", email, full_name: parsed.data.fullName,
  });
  if (userErr) {
    await rollback();
    return { error: "Could not create the resident account." };
  }
  const { data: resident, error: resErr } = await admin
    .from("residents")
    .insert({
      facility_id: profile.facility_id, user_id: uid, booking_number: parsed.data.booking,
      full_name: parsed.data.fullName, housing_unit: parsed.data.housingUnit ?? null,
    })
    .select("id")
    .single();
  if (resErr || !resident) {
    await rollback(); // cascades to public.users
    return { error: resErr?.code === "23505" ? "That booking number already exists." : "Could not create the resident." };
  }

  await admin.rpc("log_action", {
    p_facility: profile.facility_id, p_action: "resident.create", p_entity: "resident", p_entity_id: resident.id,
    p_detail: { booking_number: parsed.data.booking }, p_actor: profile.id,
  });
  revalidatePath("/staff/residents");
  return { ok: true, pin, message: `${parsed.data.fullName} was added.` };
}

export async function resetResidentPin(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = z.string().uuid().safeParse(formData.get("residentId"));
  if (!id.success) return { error: "Invalid resident" };
  const { supabase, admin, profile } = await staffContext();

  // RLS-scoped read proves this resident belongs to the staff member's facility.
  const { data: resident } = await supabase.from("residents").select("id, user_id, booking_number").eq("id", id.data).single();
  if (!resident) return { error: "Resident not found" };

  const pin = randomPin();
  const { error } = await admin.auth.admin.updateUserById(resident.user_id, { password: pin });
  if (error) return { error: "Could not reset the PIN." };
  await admin.from("residents").update({ pin_failures: 0, must_change_pin: true }).eq("id", resident.id);
  await admin.rpc("log_action", {
    p_facility: profile.facility_id, p_action: "resident.pin_reset", p_entity: "resident", p_entity_id: resident.id,
    p_detail: { booking_number: resident.booking_number }, p_actor: profile.id,
  });
  revalidatePath(`/staff/residents/${resident.id}`);
  return { ok: true, pin, message: "New one-time PIN created. Give it to the resident." };
}

export async function setSuspended(formData: FormData) {
  const id = z.string().uuid().parse(formData.get("residentId"));
  const suspend = formData.get("suspend") === "true";
  const { supabase } = await staffContext();
  await supabase.from("residents").update({ comms_suspended: suspend }).eq("id", id); // audited by trigger
  revalidatePath("/staff", "layout");
}

export async function setContactStatus(formData: FormData) {
  const id = z.string().uuid().parse(formData.get("contactId"));
  const status = z.enum(["active", "blocked"]).parse(formData.get("status"));
  const { supabase } = await staffContext();
  await supabase.rpc("set_contact_status", { p_contact: id, p_status: status });
  revalidatePath("/staff", "layout");
}
