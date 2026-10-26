import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { Card } from "@/components/ui";

export default async function StaffDashboard() {
  const { supabase } = await requireRole(["staff", "admin"]);
  const { count: pendingRequests } = await supabase
    .from("connection_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

  const [{ count: held }, { count: flagged }] = await Promise.all([
    supabase.from("messages").select("id", { count: "exact", head: true }).eq("status", "held"),
    supabase.from("messages").select("id", { count: "exact", head: true }).eq("flagged", true).neq("status", "rejected"),
  ]);

  await supabase.rpc("expire_visits");
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const [{ count: visitsPending }, { count: visitsToday }] = await Promise.all([
    supabase.from("visits").select("id", { count: "exact", head: true }).eq("status", "requested"),
    supabase.from("visits").select("id, visit_slots!inner(starts_at)", { count: "exact", head: true })
      .in("status", ["approved", "live"]).gte("visit_slots.starts_at", dayStart.toISOString()).lt("visit_slots.starts_at", dayEnd.toISOString()),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Dashboard</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link href="/staff/requests">
          <Card className="transition hover:border-blue-700">
            <p className="text-3xl font-semibold">{pendingRequests ?? 0}</p>
            <p className="text-sm text-slate-600">Connection requests waiting</p>
          </Card>
        </Link>
        <Link href="/staff/messages">
          <Card className="transition hover:border-blue-700">
            <p className="text-3xl font-semibold">{held ?? 0}</p>
            <p className="text-sm text-slate-600">Messages held for review</p>
          </Card>
        </Link>
        <Link href="/staff/messages">
          <Card className="transition hover:border-amber-500">
            <p className="text-3xl font-semibold">{flagged ?? 0}</p>
            <p className="text-sm text-slate-600">Flagged messages</p>
          </Card>
        </Link>
        <Link href="/staff/visits">
          <Card className="transition hover:border-blue-700">
            <p className="text-3xl font-semibold">{visitsToday ?? 0}</p>
            <p className="text-sm text-slate-600">Video visits today{(visitsPending ?? 0) > 0 ? ` · ${visitsPending} waiting for approval` : ""}</p>
          </Card>
        </Link>
      </div>
    </div>
  );
}
