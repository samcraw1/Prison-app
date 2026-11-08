import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { admin, facilityId, signIn, tinyPng, url } from "./helpers";
import { APP_URL } from "./app";

// The app must be started with CRON_SECRET (npm run test:int does this).
const CRON_SECRET = process.env.CRON_SECRET ?? "cron_clearline_integration";
const EMAIL = `delete-me-${Date.now()}@example.test`;
const PASSWORD = "DeleteMe!234";
let uid: string;
let fid: string;

const cron = (token?: string) =>
  fetch(`${APP_URL}/api/cron/erase-accounts`, { headers: token ? { authorization: `Bearer ${token}` } : {} });

beforeAll(async () => {
  fid = await facilityId();
  const { data, error } = await admin.auth.admin.createUser({
    email: EMAIL, password: PASSWORD, email_confirm: true, app_metadata: { role: "family", facility_id: fid },
  });
  if (error || !data.user) throw new Error(error?.message);
  uid = data.user.id;
  await admin.from("users").insert({ id: uid, facility_id: fid, role: "family", email: EMAIL, full_name: "Delete Me", phone: "555-0100" });
  await admin.storage.from("id-photos").upload(`${fid}/${uid}/id.png`, tinyPng(), { contentType: "image/png" });
});
afterAll(async () => {
  await admin.storage.from("id-photos").remove([`${fid}/${uid}/id.png`]);
});

describe("family account deletion", () => {
  it("the erasure job rejects callers without the secret", async () => {
    expect((await cron()).status).toBe(401);
    expect((await cron("wrong")).status).toBe(401);
  });

  it("requests deletion, keeps the account usable, and can cancel", async () => {
    const me = await signIn(EMAIL, PASSWORD);
    const first = await me.rpc("request_account_deletion");
    expect(first.error).toBeNull();
    expect(new Date(first.data as string).getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    expect((await me.rpc("my_balance")).error).toBeNull();
    expect((await me.rpc("cancel_account_deletion")).error).toBeNull();
    expect((await me.rpc("my_deletion")).data).toBeNull();
    expect((await me.rpc("request_account_deletion")).error).toBeNull();
  });

  it("does not erase before the grace period ends", async () => {
    expect((await cron(CRON_SECRET)).status).toBe(200);
    const { data } = await admin.from("users").select("status, email").eq("id", uid).single();
    expect(data).toMatchObject({ status: "active", email: EMAIL });
  });

  it("erases the account once due: data, photo and sign-in", async () => {
    await admin.from("users").update({ deletion_scheduled_for: new Date(Date.now() - 60_000).toISOString() }).eq("id", uid);
    const res = await cron(CRON_SECRET);
    expect(res.status).toBe(200);
    expect((await res.json()).erased).toBeGreaterThanOrEqual(1);

    const { data } = await admin.from("users").select("status, email, full_name, phone").eq("id", uid).single();
    expect(data).toEqual({ status: "deleted", email: `deleted+${uid}@invalid`, full_name: "Deleted user", phone: null });
    expect((await admin.storage.from("id-photos").list(`${fid}/${uid}`)).data).toHaveLength(0);

    const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    expect((await anon.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })).error).not.toBeNull();
  });

  it("is idempotent", async () => {
    const res = await cron(CRON_SECRET);
    expect(res.status).toBe(200);
    expect((await res.json()).erased).toBe(0);
  });
});
