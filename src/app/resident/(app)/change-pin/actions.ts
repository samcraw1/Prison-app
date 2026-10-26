"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const schema = z.object({ pin: z.string().regex(/^[0-9]{6,8}$/), confirm: z.string() }).refine((v) => v.pin === v.confirm, { message: "The PINs do not match." });

export async function changePin(_prev: { error?: string }, formData: FormData): Promise<{ error?: string }> {
  const parsed = schema.safeParse({ pin: formData.get("pin"), confirm: formData.get("confirm") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "PIN must be 6 to 8 numbers." };

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/resident/login");
  const { data: resident } = await supabase.from("residents").select("id, must_change_pin").single();
  if (!resident) redirect("/resident/login");

  const { error } = await supabase.auth.updateUser({ password: parsed.data.pin });
  if (error) return { error: "That PIN cannot be used. Try a different one." };
  await createAdminClient().from("residents").update({ must_change_pin: false }).eq("id", resident.id);
  redirect("/resident");
}
