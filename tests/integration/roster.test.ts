import { describe, expect, it } from "vitest";
import { admin, asFamily, PASSWORD, signIn, tinyPng, userId } from "./helpers";

// End-to-end through the real Supabase APIs (Auth, PostgREST, Storage) with the same calls the mobile Connect
// screen makes. Uses the seeded "riverside" facility (scripts/seed.ts). Requires `npm run db:reset` first.
const riversideId = async () => (await admin.from("facilities").select("id").eq("slug", "riverside").single()).data!.id as string;

describe("roster-verified, cross-facility connection requests", () => {
  it("verifies, uploads privately, requests, and still needs the resident facility's staff to approve", async () => {
    const fam = await asFamily(1);
    const famId = await userId(fam);
    const rid = await riversideId();

    // facility list: names only
    const { data: facilities } = await fam.rpc("list_connect_facilities");
    expect((facilities as { slug: string }[]).map((f) => f.slug)).toEqual(expect.arrayContaining(["demo-county", "riverside"]));
    expect(Object.keys((facilities as object[])[0]).sort()).toEqual(["id", "name", "slug"]);

    // roster is not readable; verification answers only true/false
    expect((await fam.from("residents").select("*").eq("facility_id", rid)).data).toEqual([]);
    expect((await fam.rpc("verify_resident", { p_facility: rid, p_resident_name: "jamie example", p_booking: "riv-2001" })).data).toBe(true);
    expect((await fam.rpc("verify_resident", { p_facility: rid, p_resident_name: "Jamie Example", p_booking: "RIV-2002" })).data).toBe(false);

    // ID photo goes to the reviewing facility's folder, private
    const path = `${rid}/${famId}/${crypto.randomUUID()}.png`;
    expect((await fam.storage.from("id-photos").upload(path, tinyPng(), { contentType: "image/png" })).error).toBeNull();
    const fam2 = await asFamily(2);
    expect((await fam2.storage.from("id-photos").createSignedUrl(path, 60)).data).toBeNull();
    const homeStaff = await signIn("staff@demo-county.test", PASSWORD);
    expect((await homeStaff.storage.from("id-photos").createSignedUrl(path, 60)).data).toBeNull();

    const { data: requestId, error } = await fam.rpc("request_connection", {
      p_facility: rid, p_resident_name: "Jamie Example", p_booking: "RIV-2001", p_relationship: "Cousin", p_id_photo_path: path,
    });
    expect(error).toBeNull();
    expect((await fam.rpc("list_my_contacts")).data as unknown[]).toHaveLength(1); // still only the existing contact

    // home facility staff can't see or act on it; riverside staff can
    expect((await homeStaff.from("connection_requests").select("id").eq("id", requestId)).data).toEqual([]);
    const rivStaff = await signIn("staff@riverside.test", PASSWORD);
    expect((await rivStaff.storage.from("id-photos").createSignedUrl(path, 60)).data?.signedUrl).toBeTruthy();
    const { data: req } = await rivStaff.from("connection_requests").select("status, resident_id").eq("id", requestId).single();
    expect(req).toMatchObject({ status: "pending" });
    expect(req!.resident_id).not.toBeNull();
    expect((await rivStaff.rpc("decide_connection", { p_request: requestId, p_approve: true })).error).toBeNull();

    // the new contact works: message lands in riverside's queue under riverside's rules
    const contacts = (await fam.rpc("list_my_contacts")).data as { contact_id: string; name: string }[];
    const jamie = contacts.find((c) => c.name === "Jamie Example")!;
    expect(jamie).toBeTruthy();
    const { data: msgId } = await fam.rpc("send_message", { p_contact: jamie.contact_id, p_body: `hello ${Date.now()}` });
    const { data: msg } = await rivStaff.from("messages").select("facility_id, status").eq("id", msgId).single();
    expect(msg).toMatchObject({ facility_id: rid, status: "held" });
    expect((await homeStaff.from("messages").select("id").eq("id", msgId)).data).toEqual([]);

    // existing home-facility contact still works
    const alex = contacts.find((c) => c.name === "Alex Demo")!;
    expect((await fam.rpc("send_message", { p_contact: alex.contact_id, p_body: "still here" })).error).toBeNull();
  });

  it("wrong booking number cannot create a connection, even after staff approve", async () => {
    const fam = await asFamily(3);
    const famId = await userId(fam);
    const rid = await riversideId();
    const path = `${rid}/${famId}/${crypto.randomUUID()}.png`;
    await fam.storage.from("id-photos").upload(path, tinyPng(), { contentType: "image/png" });
    const { data: requestId } = await fam.rpc("request_connection", {
      p_facility: rid, p_resident_name: "Avery Sample", p_booking: "RIV-9999", p_relationship: "Friend", p_id_photo_path: path,
    });
    const rivStaff = await signIn("staff@riverside.test", PASSWORD);
    const { error } = await rivStaff.rpc("decide_connection", { p_request: requestId, p_approve: true });
    expect(error?.message).toMatch(/no matching resident/);
    expect(((await fam.rpc("list_my_contacts")).data as { name: string }[]).some((c) => c.name === "Avery Sample")).toBe(false);
    await rivStaff.rpc("decide_connection", { p_request: requestId, p_approve: false, p_reason: "test cleanup" });
  });
});
