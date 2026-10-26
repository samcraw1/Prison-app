import { describe, expect, it } from "vitest";
import { asFamily, asResident, asStaff, facilityId, tinyPng, userId } from "./helpers";

describe("connection approval flow", () => {
  it("family request -> staff approve -> both sides see the contact", async () => {
    const fam = await asFamily(3);
    const fid = await facilityId();
    const uid = await userId(fam);

    // storage: own folder ok, someone else's folder rejected
    const path = `${fid}/${uid}/${crypto.randomUUID()}.png`;
    expect((await fam.storage.from("id-photos").upload(path, tinyPng(), { contentType: "image/png" })).error).toBeNull();
    const other = await fam.storage.from("id-photos").upload(`${fid}/${crypto.randomUUID()}/x.png`, tinyPng(), { contentType: "image/png" });
    expect(other.error).not.toBeNull();
    const badType = await fam.storage.from("id-photos").upload(`${fid}/${uid}/x.txt`, new Blob(["hi"], { type: "text/plain" }), { contentType: "text/plain" });
    expect(badType.error).not.toBeNull();

    const { data: reqId, error } = await fam.rpc("request_connection", {
      p_resident_name: "Casey Fakename",
      p_booking: "DEMO-1003",
      p_relationship: "Sibling",
      p_id_photo_path: path,
    });
    expect(error).toBeNull();

    // another family cannot read the ID photo
    const fam2 = await asFamily(2);
    expect((await fam2.storage.from("id-photos").createSignedUrl(path, 60)).error).not.toBeNull();

    const staff = await asStaff();
    expect((await staff.storage.from("id-photos").createSignedUrl(path, 60)).error).toBeNull();
    const { data: pending } = await staff.from("connection_requests").select("id, resident_id").eq("id", reqId);
    expect(pending).toHaveLength(1);
    expect(pending![0].resident_id).not.toBeNull();

    expect((await staff.rpc("decide_connection", { p_request: reqId, p_approve: true })).error).toBeNull();

    const { data: famContacts } = await fam.rpc("list_my_contacts");
    expect(famContacts.map((c: { name: string }) => c.name)).toContain("Casey Fakename");
    const res = await asResident("DEMO-1003");
    const { data: resContacts } = await res.rpc("list_my_contacts");
    expect(resContacts.map((c: { name: string }) => c.name)).toContain("Dana Fakename");

    // another resident does not see this family member
    const res2 = await asResident("DEMO-1004");
    const { data: res2Contacts } = await res2.rpc("list_my_contacts");
    expect(res2Contacts.map((c: { name: string }) => c.name)).not.toContain("Dana Fakename");
  });
});
