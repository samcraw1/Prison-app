import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { Badge, Button, Card } from "@/components/ui";
import { LocalTime } from "@/components/LocalTime";
import { actorNames, auditQuery, parseFilters, type AuditRow } from "@/lib/audit";

export const metadata = { title: "Audit log" };

const PAGE_SIZE = 50;
const ACTION_GROUPS = ["connection", "message", "visit", "slot", "resident", "contact", "keyword", "facility", "staff", "audit"];

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const { supabase } = await requireRole(["staff", "admin"]);
  const filters = parseFilters(params);
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const [{ data, count }, { data: staff }] = await Promise.all([
    auditQuery(supabase, filters, "id, created_at, actor_id, actor_role, action, entity, entity_id, detail", true)
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
      .returns<AuditRow[]>(),
    supabase.from("users").select("id, full_name").in("role", ["staff", "admin"]).order("full_name"),
  ]);
  const rows = data ?? [];
  const names = await actorNames(supabase, rows.map((r) => r.actor_id));
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const qs = (extra: Record<string, string | number>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...filters, ...extra })) if (v) p.set(k, String(v));
    return p.toString();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Audit log</h1>
        <a href={`/api/audit/export?${qs({})}`} className="rounded-lg bg-blue-800 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-900">Export CSV</a>
      </div>
      <Card>
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="text-sm font-medium">Action
            <select name="action" defaultValue={filters.action ?? ""} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal">
              <option value="">All</option>
              {ACTION_GROUPS.map((g) => <option key={g} value={`${g}.`}>{g}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium">Staff member
            <select name="actor" defaultValue={filters.actor ?? ""} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal">
              <option value="">Anyone</option>
              {(staff ?? []).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium">From
            <input type="date" name="from" defaultValue={filters.from} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" />
          </label>
          <label className="text-sm font-medium">To
            <input type="date" name="to" defaultValue={filters.to} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" />
          </label>
          <div className="flex items-end gap-2">
            <Button className="flex-1">Filter</Button>
            <Link href="/staff/audit" className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm hover:bg-slate-50">Clear</Link>
          </div>
        </form>
      </Card>
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr><th className="px-4 py-2">When</th><th className="px-4 py-2">Who</th><th className="px-4 py-2">Action</th><th className="px-4 py-2">Item</th><th className="px-4 py-2">Details</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id} className="align-top">
                <td className="whitespace-nowrap px-4 py-2"><LocalTime iso={r.created_at} /></td>
                <td className="px-4 py-2">{r.actor_id ? names.get(r.actor_id) ?? "Unknown" : "System"} {r.actor_role && <Badge>{r.actor_role}</Badge>}</td>
                <td className="px-4 py-2 font-mono text-xs">{r.action}</td>
                <td className="px-4 py-2 text-slate-600">{r.entity}{r.entity_id ? <span className="block font-mono text-xs text-slate-400">{r.entity_id.slice(0, 8)}</span> : null}</td>
                <td className="max-w-xs break-words px-4 py-2 font-mono text-xs text-slate-600">{Object.keys(r.detail ?? {}).length ? JSON.stringify(r.detail) : "—"}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-slate-600">No entries match.</td></tr>}
          </tbody>
        </table>
      </Card>
      <div className="flex items-center justify-between text-sm text-slate-600">
        <span>{total} entries · page {page} of {pages}</span>
        <span className="flex gap-3">
          {page > 1 && <Link className="underline" href={`/staff/audit?${qs({ page: page - 1 })}`}>Previous</Link>}
          {page < pages && <Link className="underline" href={`/staff/audit?${qs({ page: page + 1 })}`}>Next</Link>}
        </span>
      </div>
    </div>
  );
}
