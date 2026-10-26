import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { Card } from "@/components/ui";

export default async function StaffDashboard() {
  const { supabase } = await requireRole(["staff", "admin"]);
  const { count: pendingRequests } = await supabase
    .from("connection_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

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
      </div>
    </div>
  );
}
