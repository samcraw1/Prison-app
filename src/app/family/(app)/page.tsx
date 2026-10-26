import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { Badge, Card } from "@/components/ui";

export default async function FamilyHome() {
  const { supabase } = await requireRole(["family"]);
  const [{ data: contacts }, { data: requests }] = await Promise.all([
    supabase.rpc("list_my_contacts"),
    supabase
      .from("connection_requests")
      .select("id, typed_resident_name, relationship, status, deny_reason, created_at")
      .order("created_at", { ascending: false }),
  ]);
  const contactList = (contacts ?? []) as { contact_id: string; name: string }[];
  const open = (requests ?? []).filter((r) => r.status !== "approved");

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">Your connections</h1>
          <Link href="/family/connect" className="rounded-lg bg-blue-800 px-4 py-2 text-sm font-medium text-white hover:bg-blue-900">
            Connect with someone
          </Link>
        </div>
        {contactList.length ? (
          <ul className="mt-4 divide-y divide-slate-100">
            {contactList.map((c) => (
              <li key={c.contact_id} className="flex items-center justify-between py-3">
                <Link href={`/family/messages/${c.contact_id}`} className="font-medium text-blue-800 hover:underline">{c.name}</Link>
                <Link href={`/family/messages/${c.contact_id}`} className="text-sm text-blue-800 underline">Messages</Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-slate-600">No approved connections yet. Request one to get started.</p>
        )}
      </Card>

      {open.length > 0 && (
        <Card>
          <h2 className="font-semibold">Requests</h2>
          <ul className="mt-3 divide-y divide-slate-100">
            {open.map((r) => (
              <li key={r.id} className="py-3">
                <div className="flex items-center justify-between">
                  <span>{r.typed_resident_name} <span className="text-sm text-slate-500">({r.relationship})</span></span>
                  <Badge tone={r.status === "pending" ? "amber" : "red"}>{r.status === "pending" ? "Waiting for staff" : "Not approved"}</Badge>
                </div>
                {r.deny_reason && <p className="mt-1 text-sm text-slate-600">Reason: {r.deny_reason}</p>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
