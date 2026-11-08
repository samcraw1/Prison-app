import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { admin, asFamily, asStaff, asResident, PASSWORD, signIn, url } from "./helpers";
import { APP_URL } from "./app";
import { startFakeDaily, type Call } from "./fake-daily";

// The mobile app calls the same Next routes with `Authorization: Bearer <access token>` instead of a cookie.
let server: Server;
let calls: Call[];
beforeAll(async () => ({ server, calls } = await startFakeDaily()));
afterAll(() => new Promise((r) => server.close(r)));

async function bearer(email: string, password = PASSWORD) {
  const c = await signIn(email, password);
  return (await c.auth.getSession()).data.session!.access_token;
}
async function postBearer(path: string, token?: string) {
  const res = await fetch(`${APP_URL}${path}`, { method: "POST", headers: token === undefined ? {} : { authorization: token } });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function makeLiveableVisit(booking: string) {
  const { data: contact } = await admin.from("contacts").select("id, facility_id, family_user_id, residents!inner(booking_number)")
    .eq("residents.booking_number", booking).limit(1).single();
  const now = Date.now();
  const { data: slot } = await admin.from("visit_slots").insert({
    facility_id: contact!.facility_id, starts_at: new Date(now - 60_000).toISOString(), ends_at: new Date(now + 20 * 60_000).toISOString(),
  }).select("id").single();
  const { data: visit } = await admin.from("visits").insert({
    facility_id: contact!.facility_id, contact_id: contact!.id, slot_id: slot!.id, status: "approved", requested_by: contact!.family_user_id,
  }).select("id").single();
  return visit!.id as string;
}

describe("Bearer auth on visit routes (mobile)", () => {
  it("accepts a valid access token and applies the same rules as cookies", async () => {
    const visitId = await makeLiveableVisit("DEMO-1004");
    const fam4 = await bearer("family4@example.test");
    const fam5 = await bearer("family5@example.test");
    const staff = await bearer("staff@demo-county.test");

    expect((await postBearer(`/api/visits/${visitId}/join`)).status).toBe(401);
    expect((await postBearer(`/api/visits/${visitId}/join`, "Bearer not.a.jwt")).status).toBe(401);
    expect((await postBearer(`/api/visits/${visitId}/join`, "Basic abc")).status).toBe(401);
    // forged: valid shape, signed with the wrong key
    const forged = fam4.split(".").slice(0, 2).join(".") + ".AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    expect((await postBearer(`/api/visits/${visitId}/join`, `Bearer ${forged}`)).status).toBe(401);
    expect((await postBearer(`/api/visits/${visitId}/join`, `Bearer ${fam5}`)).status).toBe(404); // not their visit

    const joined = await postBearer(`/api/visits/${visitId}/join`, `Bearer ${fam4}`);
    expect(joined.status).toBe(200);
    expect(joined.body).toMatchObject({ observer: false });
    const tok = calls.filter((c) => c.path === "/meeting-tokens").at(-1)!.body as { properties: Record<string, unknown> };
    expect(tok.properties.eject_at_token_exp).toBe(true);
    expect(tok.properties.exp).toBeTypeOf("number");

    const watch = await postBearer(`/api/visits/${visitId}/join`, `Bearer ${staff}`);
    expect(watch.body.observer).toBe(true);

    expect((await postBearer(`/api/visits/${visitId}/end`, `Bearer ${fam4}`)).status).toBe(403);
    expect((await postBearer(`/api/visits/${visitId}/end`, `Bearer ${staff}`)).status).toBe(200);
    expect(calls.some((c) => c.method === "DELETE" && c.path === `/rooms/visit-${visitId}`)).toBe(true);
    expect((await postBearer(`/api/visits/${visitId}/join`, `Bearer ${fam4}`)).status).toBe(409);
  });

  it("rejects a token after sign-out", async () => {
    const c = await signIn("family4@example.test", PASSWORD);
    const token = (await c.auth.getSession()).data.session!.access_token;
    await c.auth.signOut();
    const visitId = await makeLiveableVisit("DEMO-1004");
    expect((await postBearer(`/api/visits/${visitId}/join`, `Bearer ${token}`)).status).toBe(401);
  });
});

describe("realtime respects RLS", () => {
  it("delivers a resident message only to that resident's family, and only once approved", async () => {
    const fam1 = await asFamily(1);
    const fam2 = await asFamily(2);
    const resident = await asResident("DEMO-1001");
    const staff = await asStaff();
    const { data: contacts } = await fam1.rpc("list_my_contacts");
    const contactId = (contacts as { contact_id: string }[])[0].contact_id;

    const seen: Record<string, { status: string; body: string }[]> = { fam1: [], fam2: [] };
    const subscribe = (c: typeof fam1, key: string) =>
      new Promise<void>((resolve) => {
        c.realtime.setAuth();
        c.channel(`t-${key}`)
          .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, (p) => seen[key].push(p.new as never))
          // Realtime reports server-side subscription failures on the "system" event, after SUBSCRIBED.
          .on("system", {}, (p: { status?: string; message?: string }) => { if (p.status === "error") systemErrors.push(p.message ?? "error"); })
          .subscribe((s) => s === "SUBSCRIBED" && resolve());
      });
    const systemErrors: string[] = [];
    await Promise.all([subscribe(fam1, "fam1"), subscribe(fam2, "fam2")]);
    await new Promise((r) => setTimeout(r, 1000));
    expect(systemErrors, "Realtime rejected the postgres_changes subscription").toEqual([]);

    const marker = `rt-${Date.now()}`;
    const { data: msgId, error } = await resident.rpc("send_message", { p_contact: contactId, p_body: marker });
    expect(error).toBeNull();
    await new Promise((r) => setTimeout(r, 1500));
    const held = (await admin.from("messages").select("status").eq("id", msgId).single()).data!.status;
    if (held === "held") {
      expect(seen.fam1.filter((m) => m.body === marker)).toHaveLength(0); // held: invisible to family
      expect((await staff.rpc("review_message", { p_message: msgId, p_action: "approve" })).error).toBeNull();
    }
    await expect.poll(() => seen.fam1.some((m) => m.body === marker && m.status === "delivered"), { timeout: 5000 }).toBe(true);
    expect(seen.fam2.some((m) => m.body === marker)).toBe(false);
    await Promise.all([fam1.removeAllChannels(), fam2.removeAllChannels()]);
  });

  it("anon realtime subscribers receive nothing", async () => {
    const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    const got: unknown[] = [];
    await new Promise<void>((resolve) =>
      anon.channel("anon").on("postgres_changes", { event: "*", schema: "public", table: "messages" }, (p) => got.push(p))
        .subscribe((s) => s === "SUBSCRIBED" && resolve()));
    const fam1 = await asFamily(1);
    const { data: contacts } = await fam1.rpc("list_my_contacts");
    await fam1.rpc("send_message", { p_contact: (contacts as { contact_id: string }[])[0].contact_id, p_body: `anon-${Date.now()}` });
    await new Promise((r) => setTimeout(r, 1500));
    expect(got).toHaveLength(0);
    await anon.removeAllChannels();
  });
});

describe("mobile bundle hygiene", () => {
  it("contains no server secrets", () => {
    const root = join(__dirname, "../../mobile");
    const bad = /SERVICE_ROLE|service_role|DAILY_API_KEY|PUSH_DISPATCH_SECRET|sb_secret_/;
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (["node_modules", ".expo", "ios", "android", "dist"].includes(name)) continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx|js|json)$/.test(name) && bad.test(readFileSync(p, "utf8"))) offenders.push(p);
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
