import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { APP_URL, cookieFor } from "./app";
import { admin, asFamily, asResident, asStaff, facilityId, PASSWORD, userId } from "./helpers";
import { startFakeLlm, type LlmCall } from "./fake-llm";

// Family help bot (/api/help/chat) against a fake AI Gateway. Requires `npm run db:reset` first.

let server: Server;
let calls: LlmCall[];
let reply: { text: string; fail: boolean };
const settingsBefore = new Map<string, unknown>();

const token = async (c: Awaited<ReturnType<typeof asFamily>>) => (await c.auth.getSession()).data.session!.access_token;
const riversideId = async () => (await admin.from("facilities").select("id").eq("slug", "riverside").single()).data!.id as string;

async function setHelp(facility: string, on: boolean) {
  const { data } = await admin.from("facilities").select("settings").eq("id", facility).single();
  if (!settingsBefore.has(facility)) settingsBefore.set(facility, data!.settings);
  await admin.from("facilities").update({ settings: { ...data!.settings, help_bot_enabled: on } }).eq("id", facility);
}

function chatBody(text: string) {
  return { id: "chat-1", trigger: "submit-message", messages: [{ id: "m1", role: "user", parts: [{ type: "text", text }] }] };
}

async function ask(text: string, auth: { bearer?: string; cookie?: string } = {}, body: unknown = chatBody(text)) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (auth.bearer) headers.authorization = `Bearer ${auth.bearer}`;
  if (auth.cookie) headers.cookie = auth.cookie;
  const res = await fetch(`${APP_URL}/api/help/chat`, { method: "POST", headers, body: JSON.stringify(body) });
  return { status: res.status, text: await res.text() };
}

beforeAll(async () => ({ server, calls, reply } = await startFakeLlm()));
afterAll(async () => {
  for (const [id, settings] of settingsBefore) await admin.from("facilities").update({ settings }).eq("id", id);
  await admin.from("facility_help").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await admin.from("help_usage").delete().neq("count", -1);
  await new Promise((r) => server.close(r));
});
beforeEach(() => {
  calls.length = 0;
  reply.fail = false;
});

describe("help bot access", () => {
  it("requires a signed-in family member", async () => {
    expect((await ask("hi")).status).toBe(401);
    expect((await ask("hi", { bearer: "not.a.jwt" })).status).toBe(401);
    expect((await ask("hi", { cookie: await cookieFor("staff@demo-county.test", PASSWORD) })).status).toBe(403);
    expect((await ask("hi", { bearer: await token(await asResident("DEMO-1001")) })).status).toBe(403);
    expect((await ask("hi", { bearer: await token(await asStaff()) })).status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("is off unless the facility turns it on", async () => {
    await setHelp(await facilityId(), false);
    const fam = await asFamily(2);
    expect((await fam.rpc("help_available")).data).toBe(false);
    expect((await ask("hi", { bearer: await token(fam) })).status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("rejects malformed bodies", async () => {
    await setHelp(await facilityId(), true);
    const bearer = await token(await asFamily(2));
    expect((await ask("", { bearer }, { messages: [] })).status).toBe(400);
    expect((await ask("", { bearer }, { messages: [{ role: "system", parts: [{ type: "text", text: "x" }] }] })).status).toBe(400);
    expect((await ask("", { bearer }, chatBody("   "))).status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe("help bot answers", () => {
  it("streams an answer built only from FAQs and policies, routed to no-training providers", async () => {
    const fid = await facilityId();
    const rid = await riversideId();
    await setHelp(fid, true);
    await setHelp(rid, true);
    await admin.from("facility_help").insert([
      { facility_id: fid, question: "What ID do visitors need?", answer: "A current state ID or passport." },
      { facility_id: rid, question: "Riverside parking?", answer: "Lot B only." },
    ]);

    const fam = await asFamily(2);
    expect((await fam.rpc("help_available")).data).toBe(true);
    // Families can't read the FAQ table or the usage counters directly.
    expect((await fam.from("facility_help").select("id")).data).toEqual([]);
    expect((await fam.from("help_usage").select("*")).error).not.toBeNull();

    const res = await ask("Why is my message held?", { bearer: await token(fam) });
    expect(res.status).toBe(200);
    expect(res.text).toContain(reply.text);

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call.headers["ai-language-model-id"]).toBe("anthropic/claude-haiku-5.5");
    expect(call.raw).toContain("What ID do visitors need?"); // own facility FAQ
    expect(call.raw).toContain("Why is my message held or pending?"); // platform FAQ
    expect(call.raw).not.toContain("Riverside parking"); // a facility this family has no connection with
    expect(JSON.stringify(call.body)).not.toMatch(/"zeroDataRetention"/); // owner decision: not required for the help bot (Hobby plan)
    expect(JSON.stringify(call.body)).toMatch(/"disallowPromptTraining":true/);

    // Nothing about people: no message bodies, resident names, booking numbers or the family's own details.
    const famId = await userId(fam);
    const { data: msgs } = await admin.from("messages").select("body").eq("facility_id", fid);
    for (const m of msgs ?? []) expect(call.raw).not.toContain(m.body);
    for (const s of ["Chris Placeholder", "family2@example.test", "Jordan Placeholder", "DEMO-1002", "A-14", famId]) {
      expect(call.raw).not.toContain(s);
    }
  });

  it("works with the website cookie too", async () => {
    await setHelp(await facilityId(), true);
    const res = await ask("How do visits work?", { cookie: await cookieFor("family2@example.test", PASSWORD) });
    expect(res.status).toBe(200);
    expect(res.text).toContain(reply.text);
  });

  it("hides gateway errors from the user", async () => {
    await setHelp(await facilityId(), true);
    reply.fail = true;
    const res = await ask("hello?", { bearer: await token(await asFamily(2)) });
    expect(res.text).not.toContain("no provider available");
    expect(res.text).toContain("help isn't available right now");
  });

  it("limits questions per day and stores only a count", async () => {
    await setHelp(await facilityId(), true);
    const fam = await asFamily(4);
    const famId = await userId(fam);
    await admin.from("help_usage").delete().eq("user_id", famId);

    expect((await ask("one", { bearer: await token(fam) })).status).toBe(200);
    const { data: usage } = await admin.from("help_usage").select("*").eq("user_id", famId);
    expect(usage).toHaveLength(1);
    expect(Object.keys(usage![0]).sort()).toEqual(["count", "day", "user_id"]);
    expect(usage![0].count).toBe(1);

    await admin.from("help_usage").update({ count: 30 }).eq("user_id", famId);
    calls.length = 0;
    expect((await ask("two", { bearer: await token(fam) })).status).toBe(429);
    expect(calls).toHaveLength(0);
  });

  it("reports log ids only", async () => {
    const fam = await asFamily(2);
    const since = new Date().toISOString();
    expect((await fam.rpc("report_help_answer")).error).toBeNull();
    const { data: rows } = await admin.from("audit_log").select("action, detail, actor_id").eq("action", "help.report").gte("created_at", since);
    expect(rows).toHaveLength(1);
    expect(rows![0].detail).toEqual({});
    expect((await (await asStaff()).rpc("report_help_answer")).error).not.toBeNull();
  });
});
