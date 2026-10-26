"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const decideSchema = z.object({ visitId: z.string().uuid(), approve: z.enum(["true", "false"]), reason: z.string().trim().max(300).optional() });

export async function decideVisit(formData: FormData) {
  const parsed = decideSchema.safeParse({ visitId: formData.get("visitId"), approve: formData.get("approve"), reason: formData.get("reason") || undefined });
  if (!parsed.success) redirect("/staff/visits?error=Invalid+request");
  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_visit", {
    p_visit: parsed.data.visitId, p_approve: parsed.data.approve === "true", p_reason: parsed.data.reason ?? null,
  });
  if (error) redirect(`/staff/visits?error=${encodeURIComponent(error.message)}`);
  revalidatePath("/staff", "layout");
  redirect("/staff/visits");
}

export async function deleteSlot(formData: FormData) {
  const slotId = z.string().uuid().safeParse(formData.get("slotId"));
  if (!slotId.success) redirect("/staff/visits?error=Invalid+request");
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_slot", { p_slot: slotId.data });
  if (error) redirect(`/staff/visits?error=${encodeURIComponent(error.message)}`);
  revalidatePath("/staff/visits");
  redirect("/staff/visits");
}
