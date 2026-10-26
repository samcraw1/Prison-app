import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { actorNames, auditQuery, csvCell, parseFilters, type AuditRow } from "@/lib/audit";

const MAX_ROWS = 50_000;
const PAGE = 1000;

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Please sign in" }, { status: 401 });
  const { data: me } = await supabase.from("users").select("role").eq("id", auth.user.id).single();
  if (!me || !["staff", "admin"].includes(me.role)) return NextResponse.json({ error: "Not allowed" }, { status: 403 });

  const filters = parseFilters(Object.fromEntries(new URL(request.url).searchParams));

  const rows: AuditRow[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
    const { data, error } = await auditQuery(supabase, filters).range(offset, offset + PAGE - 1).returns<AuditRow[]>();
    if (error) return NextResponse.json({ error: "Could not read the audit log" }, { status: 500 });
    rows.push(...data);
    if (data.length < PAGE) break;
  }

  const names = await actorNames(supabase, rows.map((r) => r.actor_id));
  const header = ["id", "timestamp_utc", "actor_id", "actor_name", "actor_role", "action", "entity", "entity_id", "detail"];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [r.id, new Date(r.created_at).toISOString(), r.actor_id, r.actor_id ? names.get(r.actor_id) : "system", r.actor_role, r.action, r.entity, r.entity_id, r.detail]
        .map(csvCell)
        .join(","),
    );
  }

  await supabase.rpc("log_audit_export", { p_filters: filters, p_rows: rows.length });

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(lines.join("\r\n") + "\r\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="audit-log-${stamp}.csv"`,
      "cache-control": "no-store",
    },
  });
}
