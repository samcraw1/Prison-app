import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

export const auditFilterSchema = z.object({
  action: z.string().trim().max(60).regex(/^[a-z_.]*$/).optional(),
  actor: z.string().uuid().optional(),
  entity: z.string().trim().max(40).regex(/^[a-z_]*$/).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type AuditFilters = z.infer<typeof auditFilterSchema>;

export function parseFilters(params: Record<string, string | undefined>): AuditFilters {
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v));
  const parsed = auditFilterSchema.safeParse(clean);
  return parsed.success ? parsed.data : {};
}

// RLS limits this to the signed-in staff member's facility.
export function auditQuery(supabase: SupabaseClient, f: AuditFilters, select = "id, created_at, actor_id, actor_role, action, entity, entity_id, detail", count = false) {
  let q = supabase.from("audit_log").select(select, count ? { count: "exact" } : undefined).order("id", { ascending: false });
  if (f.action) q = q.like("action", `${f.action}%`);
  if (f.actor) q = q.eq("actor_id", f.actor);
  if (f.entity) q = q.eq("entity", f.entity);
  if (f.from) q = q.gte("created_at", `${f.from}T00:00:00`);
  if (f.to) q = q.lt("created_at", new Date(new Date(`${f.to}T00:00:00`).getTime() + 86_400_000).toISOString());
  return q;
}

export type AuditRow = {
  id: number; created_at: string; actor_id: string | null; actor_role: string | null;
  action: string; entity: string; entity_id: string | null; detail: Record<string, unknown>;
};

export async function actorNames(supabase: SupabaseClient, ids: (string | null)[]) {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (unique.length === 0) return new Map<string, string>();
  const { data } = await supabase.from("users").select("id, full_name").in("id", unique);
  return new Map((data ?? []).map((u) => [u.id as string, u.full_name as string]));
}

// Spreadsheet formula injection: values that start with these characters would execute in Excel/Sheets.
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
