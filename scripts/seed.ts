// Seeds a demo facility with obviously fake data. Run after `supabase db reset`.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
const admin = createClient(url, key, { auth: { persistSession: false } });

export const DEMO_PASSWORD = "DemoPass!234";
export const DEMO_PIN = "123456";

const STAFF = [
  { name: "Sam Sample", email: "admin@demo-county.test", role: "admin" as const },
  { name: "Riley Example", email: "staff@demo-county.test", role: "staff" as const },
];
const RESIDENTS = [
  { name: "Alex Demo", booking: "DEMO-1001", unit: "A-12" },
  { name: "Jordan Placeholder", booking: "DEMO-1002", unit: "A-14" },
  { name: "Casey Fakename", booking: "DEMO-1003", unit: "B-03" },
  { name: "Morgan Testperson", booking: "DEMO-1004", unit: "B-07" },
  { name: "Taylor Notreal", booking: "DEMO-1005", unit: "C-21" },
];
const FAMILIES = [
  { name: "Pat Demo", email: "family1@example.test", phone: "555-0101" },
  { name: "Chris Placeholder", email: "family2@example.test", phone: "555-0102" },
  { name: "Dana Fakename", email: "family3@example.test", phone: "555-0103" },
  { name: "Lee Testperson", email: "family4@example.test", phone: "555-0104" },
  { name: "Robin Notreal", email: "family5@example.test", phone: "555-0105" },
];

async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, what: string) {
  const { data, error } = await p;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

async function createUser(facilityId: string, role: string, email: string, password: string, name: string, phone?: string) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role, facility_id: facilityId },
  });
  if (error || !data.user) throw new Error(`createUser ${email}: ${error?.message}`);
  await must(
    admin.from("users").insert({ id: data.user.id, facility_id: facilityId, role, email, phone: phone ?? null, full_name: name }),
    `profile ${email}`,
  );
  return data.user.id;
}

async function main() {
  const facility = await must(
    admin.from("facilities").insert({ name: "Demo County Jail (fictional)", slug: "demo-county" }).select("id").single(),
    "facility",
  );
  const fid = facility!.id;

  const staffIds: Record<string, string> = {};
  for (const s of STAFF) staffIds[s.email] = await createUser(fid, s.role, s.email, DEMO_PASSWORD, s.name);

  const residentIds: string[] = [];
  for (const r of RESIDENTS) {
    const uid = await createUser(fid, "resident", `${r.booking.toLowerCase()}@residents.kinline.test`, DEMO_PIN, r.name);
    const row = await must(
      admin
        .from("residents")
        .insert({ facility_id: fid, user_id: uid, booking_number: r.booking, full_name: r.name, housing_unit: r.unit, must_change_pin: false })
        .select("id")
        .single(),
      `resident ${r.booking}`,
    );
    residentIds.push(row!.id);
  }

  const familyIds: string[] = [];
  for (const f of FAMILIES) familyIds.push(await createUser(fid, "family", f.email, DEMO_PASSWORD, f.name, f.phone));

  // ---- keywords
  for (const word of ["weapon", "escape", "contraband"]) {
    await must(admin.from("flag_keywords").insert({ facility_id: fid, word, created_by: staffIds["staff@demo-county.test"] }), `keyword ${word}`);
  }

  // ---- approved contacts: family N <-> resident N
  const rels = ["Mother", "Sister", "Brother", "Wife", "Friend"];
  const contactIds: string[] = [];
  for (let i = 0; i < 5; i++) {
    const c = await must(
      admin.from("contacts").insert({ facility_id: fid, resident_id: residentIds[i], family_user_id: familyIds[i], relationship: rels[i] }).select("id").single(),
      `contact ${i}`,
    );
    contactIds.push(c!.id);
  }

  // ---- ID photo + a pending (matched) and an unmatched request for the staff queue
  const idPng = readFileSync("scripts/assets/sample-id.png");
  async function idPhoto(familyId: string) {
    const path = `${fid}/${familyId}/sample-id.png`;
    const { error } = await admin.storage.from("id-photos").upload(path, idPng, { contentType: "image/png", upsert: true });
    if (error) throw new Error(`id photo: ${error.message}`);
    return path;
  }
  await must(
    admin.from("connection_requests").insert({
      facility_id: fid, family_user_id: familyIds[4], resident_id: residentIds[0], typed_resident_name: "Alex Demo",
      typed_booking_number: "DEMO-1001", relationship: "Cousin", id_photo_path: await idPhoto(familyIds[4]),
    }),
    "pending request",
  );
  await must(
    admin.from("connection_requests").insert({
      facility_id: fid, family_user_id: familyIds[2], resident_id: null, typed_resident_name: "Unknown Person",
      typed_booking_number: "DEMO-9999", relationship: "Friend", id_photo_path: await idPhoto(familyIds[2]),
    }),
    "unmatched request",
  );

  // ---- sample messages (inserted directly with explicit status; real traffic goes through send_message)
  const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
  const msg = (i: number, sender: "family" | "resident", body: string, status: "held" | "delivered", min: number, flag: string[] = []) => ({
    facility_id: fid, contact_id: contactIds[i], sender, body, status,
    flagged: flag.length > 0, flag_reasons: flag, created_at: ago(min), delivered_at: status === "delivered" ? ago(min) : null,
  });
  await must(
    admin.from("messages").insert([
      msg(0, "family", "Hi love, the garden is doing great this year. Thinking of you every day.", "delivered", 240),
      msg(0, "resident", "Miss you too, Mom. Tell everyone I said hi.", "delivered", 200),
      msg(0, "family", "We're coming to see you Saturday. Bring a drawing for your niece?", "held", 12),
      msg(1, "family", "Do you need anything from the legal aid office? I can call them Monday.", "held", 25),
      msg(2, "resident", "I heard there might be an escape plan, jk. Funny rumor going around.", "held", 8, ["escape"]),
      msg(3, "family", "Happy anniversary. The kids made you cards, I will send photos soon.", "delivered", 90),
      msg(4, "resident", "Thanks for putting money on my books, buddy.", "held", 5),
    ]),
    "messages",
  );

  console.log("Seeded demo-county.");
  console.log(`Staff:    staff@demo-county.test / admin@demo-county.test  (${DEMO_PASSWORD})`);
  console.log(`Family:   family1..5@example.test (${DEMO_PASSWORD})`);
  console.log(`Resident: booking DEMO-1001..1005, PIN ${DEMO_PIN}`);
  return { fid, staffIds, residentIds, familyIds };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
