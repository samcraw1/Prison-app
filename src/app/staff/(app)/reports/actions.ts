"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export async function resolveReport(formData: FormData) {
  const parsed = z.string().uuid().safeParse(formData.get("reportId"));
  if (!parsed.success) redirect("/staff/reports?error=Invalid+report");
  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_report", { p_report: parsed.data });
  if (error) redirect("/staff/reports?error=Could+not+resolve+report");
  revalidatePath("/staff/reports");
  redirect("/staff/reports");
}
