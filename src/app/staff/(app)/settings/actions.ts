"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { staffContext, type ActionState } from "@/lib/staff-context";

const settingsSchema = z.object({
  hold_all_messages: z.boolean(),
  max_visit_minutes: z.coerce.number().int().min(5).max(120),
  max_visits_per_week: z.coerce.number().int().min(1).max(14),
});

export async function saveSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = settingsSchema.safeParse({
    hold_all_messages: formData.get("hold_all_messages") === "on",
    max_visit_minutes: formData.get("max_visit_minutes"),
    max_visits_per_week: formData.get("max_visits_per_week"),
  });
  if (!parsed.success) return { error: "Please check the numbers and try again." };

  const { supabase, profile } = await staffContext({ adminOnly: true });
  const { data: current } = await supabase.from("facilities").select("settings").eq("id", profile.facility_id).single();
  const { error } = await supabase
    .from("facilities")
    .update({ settings: { ...(current?.settings ?? {}), ...parsed.data } }) // audited by trigger
    .eq("id", profile.facility_id);
  if (error) return { error: "Could not save settings." };
  revalidatePath("/staff", "layout");
  return { ok: true, message: "Settings saved." };
}

export async function addKeyword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const word = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9 '-]{1,39}$/, "Use 2-40 letters, numbers, spaces or dashes").safeParse(formData.get("word"));
  if (!word.success) return { error: word.error.issues[0]?.message };
  const { supabase } = await staffContext();
  const { error } = await supabase.rpc("add_keyword", { p_word: word.data });
  if (error) return { error: "Could not add the word." };
  revalidatePath("/staff/settings");
  return { ok: true, message: `Added “${word.data}”.` };
}

export async function removeKeyword(formData: FormData) {
  const id = z.string().uuid().parse(formData.get("keywordId"));
  const { supabase } = await staffContext();
  await supabase.rpc("remove_keyword", { p_id: id });
  revalidatePath("/staff/settings");
}
