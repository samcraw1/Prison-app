import { describe, expect, it } from "vitest";
import { admin, PASSWORD } from "./helpers";
import { APP_URL, cookieFor } from "./app";

async function get(path: string, cookie?: string) {
  const res = await fetch(`${APP_URL}${path}`, { headers: cookie ? { cookie } : {}, redirect: "manual" });
  return { status: res.status, text: await res.text(), type: res.headers.get("content-type") ?? "" };
}

describe("audit export", () => {
  it("is staff-only, scoped, filterable, escaped, and itself audited", async () => {
    expect((await get("/api/audit/export")).status).toBe(401);
    expect((await get("/api/audit/export", await cookieFor("family1@example.test", PASSWORD))).status).toBe(403);

    // a value that would run as a spreadsheet formula must be neutralised
    const { data: fac } = await admin.from("facilities").select("id").eq("slug", "demo-county").single();
    await admin.rpc("log_action", { p_facility: fac!.id, p_action: "keyword.add", p_entity: "flag_keyword", p_entity_id: null, p_detail: { word: '=HYPERLINK("http://x")' } });

    const staff = await cookieFor("staff@demo-county.test", PASSWORD);
    const all = await get("/api/audit/export", staff);
    expect(all.status).toBe(200);
    expect(all.type).toContain("text/csv");
    const lines = all.text.trim().split("\r\n");
    expect(lines[0]).toBe("id,timestamp_utc,actor_id,actor_name,actor_role,action,entity,entity_id,detail");
    expect(lines.length).toBeGreaterThan(3);
    expect(all.text).not.toMatch(/,=HYPERLINK/);

    const before = lines.length;
    const filtered = await get("/api/audit/export?action=keyword.", staff);
    const fl = filtered.text.trim().split("\r\n");
    expect(fl.length).toBeGreaterThan(1);
    expect(fl.length).toBeLessThan(before);
    expect(fl.slice(1).every((l) => l.includes(",keyword."))).toBe(true);

    // bad filters are ignored, not injected
    expect((await get("/api/audit/export?action=%27%3Bdrop%20table", staff)).status).toBe(200);

    const { data } = await admin.from("audit_log").select("action").eq("action", "audit.export");
    expect(data!.length).toBeGreaterThanOrEqual(2);

    const page = await get("/staff/audit", staff);
    expect(page.status).toBe(200);
    expect(page.text).toContain("Export CSV");
  });
});
