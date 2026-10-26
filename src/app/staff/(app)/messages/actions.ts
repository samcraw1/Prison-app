"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({
  messageId: z.string().uuid(),
  action: z.enum(["approve", "reject", "flag"]),
  reason: z.string().trim().max(300).optional(),
});

export async function reviewMessage(formData: FormData) {
  const parsed = schema.safeParse({
    messageId: formData.get("messageId"),
    action: formData.get("action"),
    reason: formData.get("reason") || undefined,
  });
  if (!parsed.success) redirect("/staff/messages?error=Invalid+request");

  const supabase = await createClient();
  const { error } = await supabase.rpc("review_message", {
    p_message: parsed.data.messageId,
    p_action: parsed.data.action,
    p_reason: parsed.data.reason ?? null,
  });
  if (error) redirect(`/staff/messages?error=${encodeURIComponent(error.message)}`);
  revalidatePath("/staff", "layout");
  redirect("/staff/messages");
}
