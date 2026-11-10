"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { staffContext, type ActionState } from "@/lib/staff-context";

const settingsSchema = z.object({
  hold_all_messages: z.boolean(),
  max_visit_minutes: z.coerce.number().int().min(5).max(120),
  max_visits_per_week: z.coerce.number().int().min(1).max(14),
  // Rate card, entered in dollars and stored in whole cents (limits match the database check constraint).
  message_fee_cents: z.coerce.number().min(0).max(5).transform((d) => Math.round(d * 100)),
  visit_fee_cents: z.coerce.number().min(0).max(50).transform((d) => Math.round(d * 100)),
  free_messages_per_week: z.coerce.number().int().min(0).max(500),
  help_bot_enabled: z.boolean(),
});

export async function saveSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = settingsSchema.safeParse({
    hold_all_messages: formData.get("hold_all_messages") === "on",
    max_visit_minutes: formData.get("max_visit_minutes"),
    max_visits_per_week: formData.get("max_visits_per_week"),
    message_fee_cents: formData.get("message_fee") ?? 0,
    visit_fee_cents: formData.get("visit_fee") ?? 0,
    free_messages_per_week: formData.get("free_messages_per_week") ?? 0,
    help_bot_enabled: formData.get("help_bot_enabled") === "on",
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

const helpSchema = z.object({
  id: z.string().uuid().nullable(),
  question: z.string().trim().min(3, "Questions need at least 3 characters.").max(200),
  answer: z.string().trim().min(1, "Please write an answer.").max(2000),
});

export async function saveHelpEntry(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = helpSchema.safeParse({
    id: formData.get("id") || null,
    question: formData.get("question"),
    answer: formData.get("answer"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the entry." };
  const { supabase } = await staffContext();
  const { error } = await supabase.rpc("save_facility_help", {
    p_id: parsed.data.id, p_question: parsed.data.question, p_answer: parsed.data.answer,
  });
  if (error) return { error: "Could not save the entry." };
  revalidatePath("/staff/settings/help");
  return { ok: true, message: "Saved." };
}

export async function deleteHelpEntry(formData: FormData) {
  const id = z.string().uuid().parse(formData.get("id"));
  const { supabase } = await staffContext();
  await supabase.rpc("delete_facility_help", { p_id: id });
  revalidatePath("/staff/settings/help");
}
