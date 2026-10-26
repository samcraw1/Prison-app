"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({
  requestId: z.string().uuid(),
  approve: z.enum(["true", "false"]),
  reason: z.string().trim().max(300).optional(),
});

export async function decideRequest(formData: FormData) {
  const parsed = schema.safeParse({
    requestId: formData.get("requestId"),
    approve: formData.get("approve"),
    reason: formData.get("reason") || undefined,
  });
  if (!parsed.success) redirect("/staff/requests?error=Invalid+request");

  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_connection", {
    p_request: parsed.data.requestId,
    p_approve: parsed.data.approve === "true",
    p_reason: parsed.data.reason ?? null,
  });
  if (error) redirect(`/staff/requests?error=${encodeURIComponent(error.message)}`);
  revalidatePath("/staff", "layout");
  redirect("/staff/requests");
}
