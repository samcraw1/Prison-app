// Seeds a demo facility with obviously fake data. Run after `supabase db reset`.
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
  const fid = facility.id;

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
    residentIds.push(row.id);
  }

  const familyIds: string[] = [];
  for (const f of FAMILIES) familyIds.push(await createUser(fid, "family", f.email, DEMO_PASSWORD, f.name, f.phone));

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
