import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { MAX_PIN_FAILURES, residentLoginSchema } from "@/lib/validation";

const BAD = { error: "Booking number or PIN is not right." };

export async function POST(request: Request) {
  const parsed = residentLoginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json(BAD, { status: 400 });
  const { facility, booking, pin } = parsed.data;

  const admin = createAdminClient();
  const { data: fac } = await admin.from("facilities").select("id").eq("slug", facility).maybeSingle();
  if (!fac) return NextResponse.json(BAD, { status: 401 });

  const { data: resident } = await admin
    .from("residents")
    .select("id, pin_failures, users!inner(email, status)")
    .eq("facility_id", fac.id)
    .eq("booking_number", booking)
    .maybeSingle();
  const account = resident && (Array.isArray(resident.users) ? resident.users[0] : resident.users);
  if (!resident || !account || account.status !== "active") {
    return NextResponse.json(BAD, { status: 401 });
  }
  if (resident.pin_failures >= MAX_PIN_FAILURES) {
    return NextResponse.json({ error: "This account is locked. Please ask a staff member." }, { status: 423 });
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: account.email, password: pin });
  if (error) {
    await admin.from("residents").update({ pin_failures: resident.pin_failures + 1 }).eq("id", resident.id);
    return NextResponse.json(BAD, { status: 401 });
  }
  if (resident.pin_failures > 0) {
    await admin.from("residents").update({ pin_failures: 0 }).eq("id", resident.id);
  }
  return NextResponse.json({ ok: true });
}
