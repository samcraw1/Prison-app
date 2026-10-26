import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { familySignupSchema } from "@/lib/validation";

export async function POST(request: Request) {
  const parsed = familySignupSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { facility, fullName, email, phone, password } = parsed.data;
  const admin = createAdminClient();

  const { data: fac } = await admin.from("facilities").select("id").eq("slug", facility).maybeSingle();
  if (!fac) return NextResponse.json({ error: "Facility not found" }, { status: 404 });

  // role/facility live in app_metadata, which clients cannot set.
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // production: require email verification
    app_metadata: { role: "family", facility_id: fac.id },
  });
  if (error || !created.user) {
    return NextResponse.json({ error: "Could not create account" }, { status: 400 });
  }

  const { error: profileError } = await admin.from("users").insert({
    id: created.user.id,
    facility_id: fac.id,
    role: "family",
    email,
    phone,
    full_name: fullName,
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: "Could not create account" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
