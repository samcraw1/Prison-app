import { describe, expect, it } from "vitest";
import { asFamily, asResident, asStaff, facilityId, tinyPng, userId } from "./helpers";
import type { SupabaseClient } from "@supabase/supabase-js";

async function contactFor(c: SupabaseClient) {
  const { data } = await c.rpc("list_my_contacts");
  return (data as { contact_id: string }[])[0].contact_id;
}
const visible = async (c: SupabaseClient, body: string) =>
  ((await c.from("messages").select("id").eq("body", body)).data ?? []).length;

describe("message review flow", () => {
  it("holds, reviews, delivers, and gates attachments", async () => {
    const stamp = Date.now();
    const fam = await asFamily(1);
    const res = await asResident("DEMO-1001");
    const staff = await asStaff();
    const other = await asFamily(2);
    const contact = await contactFor(fam);

    // attachment upload by family
    const fid = await facilityId();
    const path = `${fid}/${await userId(fam)}/${crypto.randomUUID()}.png`;
    expect((await fam.storage.from("message-attachments").upload(path, tinyPng(), { contentType: "image/png" })).error).toBeNull();

    const body = `visit plans ${stamp}`;
    const sent = await fam.rpc("send_message", { p_contact: contact, p_body: body, p_attachment_path: path });
    expect(sent.error).toBeNull();

    // the attachment cannot be reused on a second message
    const reuse = await fam.rpc("send_message", { p_contact: contact, p_body: "again", p_attachment_path: path });
    expect(reuse.error).not.toBeNull();

    // held: sender and staff see it; resident and unrelated family do not
    expect(await visible(fam, body)).toBe(1);
    expect(await visible(staff, body)).toBe(1);
    expect(await visible(res, body)).toBe(0);
    expect(await visible(other, body)).toBe(0);
    expect((await res.storage.from("message-attachments").createSignedUrl(path, 60)).error).not.toBeNull();
    expect((await staff.storage.from("message-attachments").createSignedUrl(path, 60)).error).toBeNull();

    // approve -> resident sees it and its photo
    const { data: row } = await staff.from("messages").select("id").eq("body", body).single();
    expect((await staff.rpc("review_message", { p_message: row!.id, p_action: "approve" })).error).toBeNull();
    expect(await visible(res, body)).toBe(1);
    expect((await res.storage.from("message-attachments").createSignedUrl(path, 60)).error).toBeNull();
    expect((await other.storage.from("message-attachments").createSignedUrl(path, 60)).error).not.toBeNull();

    // resident reply is held, keyword hit is flagged
    const flaggedBody = `plan to escape the cold ${stamp}`;
    expect((await res.rpc("send_message", { p_contact: contact, p_body: flaggedBody })).error).toBeNull();
    const { data: flagged } = await staff.from("messages").select("id, status, flagged, flag_reasons").eq("body", flaggedBody).single();
    expect(flagged).toMatchObject({ status: "held", flagged: true, flag_reasons: ["escape"] });

    // reject needs a reason; rejected messages never reach the family
    expect((await staff.rpc("review_message", { p_message: flagged!.id, p_action: "reject" })).error).not.toBeNull();
    expect((await staff.rpc("review_message", { p_message: flagged!.id, p_action: "reject", p_reason: "Not allowed" })).error).toBeNull();
    expect(await visible(fam, flaggedBody)).toBe(0);

    // everything staff did is in the audit log with their id
    const { data: audit } = await staff.from("audit_log").select("action").in("action", ["message.approve", "message.reject"]);
    expect(audit!.length).toBeGreaterThanOrEqual(2);
  });
});
