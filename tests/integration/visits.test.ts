import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { admin, PASSWORD, PIN } from "./helpers";
import { cookieFor, post } from "./app";
import { startFakeDaily, type Call } from "./fake-daily";

// Requires the app on APP_URL started with DAILY_API_KEY=test DAILY_API_URL=http://127.0.0.1:4999
// (npm run test:int does this).
let server: Server;
let calls: Call[];
beforeAll(async () => ({ server, calls } = await startFakeDaily()));
afterAll(() => new Promise((r) => server.close(r)));

async function visitFor(booking: string, status: string) {
  const { data } = await admin
    .from("visits")
    .select("id, status, ended_by, end_reason, contacts!inner(residents!inner(booking_number))")
    .eq("contacts.residents.booking_number", booking)
    .eq("status", status)
    .limit(1);
  return data?.[0];
}

describe("video visit join / watch / end", () => {
  it("enforces who can join, hides staff observers, and records the end", async () => {
    const visit = (await visitFor("DEMO-1001", "approved"))!;
    expect(visit).toBeTruthy();
    const family1 = await cookieFor("family1@example.test", PASSWORD);
    const family2 = await cookieFor("family2@example.test", PASSWORD);
    const resident1 = await cookieFor("demo-1001@residents.kinline.test", PIN);
    const staff = await cookieFor("staff@demo-county.test", PASSWORD);

    expect((await post(`/api/visits/${visit.id}/join`)).status).toBe(401);
    expect((await post(`/api/visits/${visit.id}/join`, family2)).status).toBe(404); // not their visit
    expect((await post(`/api/visits/not-a-uuid/join`, family1)).status).toBe(404);
    expect((await post(`/api/visits/${visit.id}/join`, staff)).status).toBe(409); // staff may only watch live visits

    const joined = await post(`/api/visits/${visit.id}/join`, family1);
    expect(joined.status).toBe(200);
    expect(joined.body).toMatchObject({ observer: false });
    expect(joined.body.url).toContain(`visit-${visit.id}`);
    expect(calls.some((c) => c.path === "/rooms")).toBe(true);
    const familyToken = calls.filter((c) => c.path === "/meeting-tokens").at(-1)!.body as { properties: Record<string, unknown> };
    expect(familyToken.properties.permissions).toBeUndefined();
    expect(familyToken.properties.is_owner).toBe(false);

    expect((await admin.from("visits").select("status, started_at").eq("id", visit.id).single()).data).toMatchObject({ status: "live" });
    expect((await post(`/api/visits/${visit.id}/join`, resident1)).status).toBe(200);

    // staff watch: hidden, receive-only
    const watch = await post(`/api/visits/${visit.id}/join`, staff);
    expect(watch.status).toBe(200);
    expect(watch.body.observer).toBe(true);
    const staffToken = calls.filter((c) => c.path === "/meeting-tokens").at(-1)!.body as { properties: { permissions: Record<string, boolean> } };
    expect(staffToken.properties.permissions).toEqual({ hasPresence: false, canSend: false });

    // only staff can end; ending removes the room and records who did it
    expect((await post(`/api/visits/${visit.id}/end`, family1)).status).toBe(403);
    expect((await post(`/api/visits/${visit.id}/end`, staff)).status).toBe(200);
    expect(calls.some((c) => c.method === "DELETE" && c.path === `/rooms/visit-${visit.id}`)).toBe(true);
    const ended = (await admin.from("visits").select("status, ended_by, end_reason, ended_at").eq("id", visit.id).single()).data!;
    expect(ended).toMatchObject({ status: "ended", end_reason: "staff" });
    expect(ended.ended_by).not.toBeNull();
    expect((await post(`/api/visits/${visit.id}/join`, family1)).status).toBe(409);
    expect((await post(`/api/visits/${visit.id}/end`, staff)).status).toBe(409);

    const { data: audit } = await admin.from("audit_log").select("action").in("action", ["visit.watch", "visit.end"]).order("id", { ascending: false }).limit(2);
    expect(audit!.map((a) => a.action).sort()).toEqual(["visit.end", "visit.watch"]);
  });

  it("blocks joining early and for suspended residents", async () => {
    const family3 = await cookieFor("family3@example.test", PASSWORD);
    const staff = await cookieFor("staff@demo-county.test", PASSWORD);
    const requested = (await visitFor("DEMO-1003", "requested"))!;
    expect((await post(`/api/visits/${requested.id}/join`, family3)).status).toBe(409); // not approved yet

    await admin.from("visits").update({ status: "approved" }).eq("id", requested.id);
    const early = await post(`/api/visits/${requested.id}/join`, family3);
    expect(early.status).toBe(409);
    expect(early.body.error).toMatch(/not time/i);

    // suspended resident cannot join even an open visit
    const open = (await visitFor("DEMO-1002", "approved"))!;
    const family2 = await cookieFor("family2@example.test", PASSWORD);
    await admin.from("residents").update({ comms_suspended: true }).eq("booking_number", "DEMO-1002");
    expect((await post(`/api/visits/${open.id}/join`, family2)).status).toBe(403);
    await admin.from("residents").update({ comms_suspended: false }).eq("booking_number", "DEMO-1002");
    expect((await post(`/api/visits/${open.id}/join`, family2)).status).toBe(200);
    expect((await post(`/api/visits/${open.id}/end`, staff)).status).toBe(200);
  });
});
