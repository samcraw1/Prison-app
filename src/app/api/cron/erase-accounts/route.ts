import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Daily job (vercel.json). Erases family accounts whose 30-day deletion grace period has ended. Vercel sends
// `Authorization: Bearer $CRON_SECRET`. Order matters so a failure leaves the account retryable on the next run:
// ID photos -> disable the sign-in -> erase database rows (the step that marks the account deleted).
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  const { data: due, error } = await admin.rpc("accounts_due_for_erasure");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let erased = 0;
  const failed: string[] = [];
  for (const { user_id, facility_id } of (due ?? []) as { user_id: string; facility_id: string }[]) {
    try {
      // ID photos live at <facility>/<user>/<file> in the id-photos bucket.
      const folder = `${facility_id}/${user_id}`;
      const { data: files, error: listErr } = await admin.storage.from("id-photos").list(folder);
      if (listErr) throw listErr;
      if (files?.length) {
        const { error: rmErr } = await admin.storage.from("id-photos").remove(files.map((f) => `${folder}/${f.name}`));
        if (rmErr) throw rmErr;
      }
      // Cannot delete the auth user (ledger rows reference it). Make the identity unusable instead.
      const { error: authErr } = await admin.auth.admin.updateUserById(user_id, {
        email: `deleted+${user_id}@invalid`,
        password: crypto.randomUUID() + crypto.randomUUID(),
        ban_duration: "876000h",
        user_metadata: {},
      });
      if (authErr) throw authErr;
      const { error: dbErr } = await admin.rpc("erase_family_account", { p_user: user_id });
      if (dbErr) throw dbErr;
      erased += 1;
    } catch (e) {
      console.error("account erasure failed", user_id, e instanceof Error ? e.message : e);
      failed.push(user_id);
    }
  }
  return NextResponse.json({ erased, failed: failed.length }, { status: failed.length ? 500 : 200 });
}
