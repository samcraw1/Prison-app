import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { Badge, Button, Card } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { resetResidentPin, setContactStatus, setSuspended } from "../actions";

type ContactRow = {
  id: string;
  relationship: string;
  status: "active" | "blocked";
  users: { full_name: string; email: string } | null;
};

export default async function ResidentProfile({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireRole(["staff", "admin"]);
  const { data: resident } = await supabase.from("residents").select("*").eq("id", id).maybeSingle();
  if (!resident) notFound();

  const [{ data: contacts }, { data: messages }] = await Promise.all([
    supabase
      .from("contacts")
      .select("id, relationship, status, users:users!contacts_family_user_id_fkey(full_name, email)")
      .eq("resident_id", id)
      .returns<ContactRow[]>(),
    supabase
      .from("messages")
      .select("id, sender, body, status, flagged, created_at, contacts!inner(resident_id, users:users!contacts_family_user_id_fkey(full_name))")
      .eq("contacts.resident_id", id)
      .order("created_at", { ascending: false })
      .limit(25),
  ]);

  return (
    <div className="space-y-6">
      <Link href="/staff/residents" className="text-sm text-blue-800 underline">← Residents</Link>
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">{resident.full_name}</h1>
            <p className="text-sm text-slate-600">Booking {resident.booking_number}{resident.housing_unit ? ` · Unit ${resident.housing_unit}` : ""}</p>
            <div className="mt-2 flex gap-2">
              {resident.comms_suspended ? <Badge tone="red">Communication suspended</Badge> : <Badge tone="green">Communication active</Badge>}
              {resident.pin_failures >= 5 && <Badge tone="amber">PIN locked</Badge>}
            </div>
          </div>
          <div className="flex flex-col items-end gap-3">
            <form action={setSuspended}>
              <input type="hidden" name="residentId" value={resident.id} />
              <input type="hidden" name="suspend" value={String(!resident.comms_suspended)} />
              <Button variant={resident.comms_suspended ? "secondary" : "danger"}>
                {resident.comms_suspended ? "Restore communication" : "Suspend communication"}
              </Button>
            </form>
            <ActionForm action={resetResidentPin} className="text-right">
              <input type="hidden" name="residentId" value={resident.id} />
              <Button variant="secondary">Reset PIN / unlock</Button>
            </ActionForm>
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="font-semibold">Approved contacts</h2>
        <ul className="mt-3 divide-y divide-slate-100">
          {(contacts ?? []).map((c) => (
            <li key={c.id} className="flex items-center justify-between py-3">
              <span>
                <span className="font-medium">{c.users?.full_name}</span>
                <span className="ml-2 text-sm text-slate-500">{c.relationship} · {c.users?.email}</span>
              </span>
              <form action={setContactStatus} className="flex items-center gap-3">
                <input type="hidden" name="contactId" value={c.id} />
                <input type="hidden" name="status" value={c.status === "active" ? "blocked" : "active"} />
                {c.status === "blocked" && <Badge tone="red">Blocked</Badge>}
                <Button variant={c.status === "active" ? "danger" : "secondary"} className="py-1.5 text-sm">
                  {c.status === "active" ? "Block" : "Unblock"}
                </Button>
              </form>
            </li>
          ))}
          {(contacts ?? []).length === 0 && <li className="py-3 text-slate-600">No approved contacts.</li>}
        </ul>
      </Card>

      <Card>
        <h2 className="font-semibold">Message history</h2>
        <ul className="mt-3 divide-y divide-slate-100">
          {(messages ?? []).map((m) => {
            const c = Array.isArray(m.contacts) ? m.contacts[0] : m.contacts;
            const u = c && (Array.isArray(c.users) ? c.users[0] : c.users);
            return (
              <li key={m.id} className="py-3">
                <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                  <span className="font-medium text-slate-900">{m.sender === "family" ? u?.full_name : resident.full_name}</span>
                  <span>{new Date(m.created_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</span>
                  <Badge tone={m.status === "delivered" ? "green" : m.status === "held" ? "amber" : "red"}>{m.status}</Badge>
                  {m.flagged && <Badge tone="amber">Flagged</Badge>}
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words">{m.body}</p>
              </li>
            );
          })}
          {(messages ?? []).length === 0 && <li className="py-3 text-slate-600">No messages yet.</li>}
        </ul>
      </Card>
    </div>
  );
}
