import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Daily job (vercel.json). Deletes AI-feature data past its retention period (docs/AI.md, "Retention").
// Vercel sends `Authorization: Bearer $CRON_SECRET`.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data, error } = await createAdminClient().rpc("purge_ai_data");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ purged: data });
}
