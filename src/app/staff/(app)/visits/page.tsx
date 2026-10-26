import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { Badge, Button, Card, ErrorText } from "@/components/ui";
import { LocalTime } from "@/components/LocalTime";
import { AutoRefresh } from "@/components/AutoRefresh";
import { decideVisit, deleteSlot } from "./actions";
import { SlotForm } from "./SlotForm";
import { EndVisitButton } from "./EndVisitButton";

export const metadata = { title: "Video visits" };

type Row = {
  id: string;
  status: "requested" | "approved" | "denied" | "live" | "ended" | "cancelled";
  started_at: string | null;
  ended_at: string | null;
  end_reason: string | null;
  deny_reason: string | null;
  slot_id: string;
  visit_slots: { starts_at: string; ends_at: string };
  contacts: { relationship: string; residents: { full_name: string; booking_number: string } | null; users: { full_name: string } | null } | null;
  ender: { full_name: string } | null;
};

const SELECT =
  "id, status, started_at, ended_at, end_reason, deny_reason, slot_id, visit_slots(starts_at, ends_at), contacts(relationship, residents(full_name, booking_number), users:users!contacts_family_user_id_fkey(full_name)), ender:users!visits_ended_by_fkey(full_name)";

export default async function StaffVisits({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const { supabase } = await requireRole(["staff", "admin"]);
  await supabase.rpc("expire_visits");

  const [{ data }, { data: slots }, { data: facility }] = await Promise.all([
    supabase.from("visits").select(SELECT).returns<Row[]>(),
    supabase.from("visit_slots").select("id, starts_at, ends_at, capacity").gte("ends_at", new Date().toISOString()).order("starts_at"),
    supabase.from("facilities").select("settings").single(),
  ]);
  const visits = data ?? [];
  const byStart = (a: Row, b: Row) => a.visit_slots.starts_at.localeCompare(b.visit_slots.starts_at);
  const requested = visits.filter((v) => v.status === "requested").sort(byStart);
  const live = visits.filter((v) => v.status === "live").sort(byStart);
  const approved = visits.filter((v) => v.status === "approved").sort(byStart);
  const history = visits.filter((v) => ["ended", "cancelled", "denied"].includes(v.status)).sort((a, b) => byStart(b, a)).slice(0, 15);
  const booked = (slotId: string) => visits.filter((v) => v.slot_id === slotId && ["requested", "approved", "live"].includes(v.status)).length;
  const maxMinutes = (facility?.settings as { max_visit_minutes?: number } | null)?.max_visit_minutes ?? 30;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <AutoRefresh seconds={15} />
      <div className="space-y-6">
        <h1 className="text-xl font-semibold">Video visits</h1>
        <ErrorText>{error}</ErrorText>

        <Section title={`Live now (${live.length})`}>
          {live.map((v) => (
            <Item key={v.id} v={v}>
              <Link href={`/staff/visits/${v.id}`} className="rounded-lg bg-blue-800 px-4 py-1.5 text-sm font-medium text-white">Watch</Link>
              <EndVisitButton visitId={v.id} small />
            </Item>
          ))}
          {live.length === 0 && <Empty>No visits are in progress.</Empty>}
        </Section>

        <Section title={`Waiting for approval (${requested.length})`}>
          {requested.map((v) => (
            <Item key={v.id} v={v}>
              <form action={decideVisit} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="visitId" value={v.id} />
                <input name="reason" placeholder="Reason (if denying)" maxLength={300} className="w-44 rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
                <Button name="approve" value="true" className="py-1.5 text-sm">Approve</Button>
                <Button name="approve" value="false" variant="danger" className="py-1.5 text-sm">Deny</Button>
              </form>
            </Item>
          ))}
          {requested.length === 0 && <Empty>Nothing waiting.</Empty>}
        </Section>

        <Section title={`Approved (${approved.length})`}>
          {approved.map((v) => <Item key={v.id} v={v}><Badge tone="green">Approved</Badge></Item>)}
          {approved.length === 0 && <Empty>No approved visits coming up.</Empty>}
        </Section>

        <Section title="History">
          {history.map((v) => (
            <Item key={v.id} v={v}>
              <div className="text-right text-xs text-slate-600">
                <Badge tone={v.status === "ended" ? "slate" : v.status === "denied" ? "red" : "amber"}>{v.status}</Badge>
                {v.started_at && v.ended_at && (
                  <p className="mt-1">{Math.max(1, Math.round((new Date(v.ended_at).getTime() - new Date(v.started_at).getTime()) / 60000))} min · ended by {v.ender?.full_name ?? (v.end_reason === "time" ? "time limit" : v.end_reason ?? "—")}</p>
                )}
                {v.deny_reason && <p className="mt-1">{v.deny_reason}</p>}
              </div>
            </Item>
          ))}
          {history.length === 0 && <Empty>No past visits yet.</Empty>}
        </Section>
      </div>

      <div className="space-y-6">
        <Card>
          <h2 className="font-semibold">Add a time slot</h2>
          <div className="mt-3"><SlotForm maxMinutes={maxMinutes} /></div>
        </Card>
        <Card>
          <h2 className="font-semibold">Upcoming slots</h2>
          <ul className="mt-3 divide-y divide-slate-100 text-sm">
            {(slots ?? []).map((s) => (
              <li key={s.id} className="flex items-center justify-between py-2">
                <span><LocalTime iso={s.starts_at} /> <span className="text-slate-500">· {s.capacity} at once · {booked(s.id)} booked</span></span>
                <form action={deleteSlot}>
                  <input type="hidden" name="slotId" value={s.id} />
                  <button className="text-red-700 underline">Delete</button>
                </form>
              </li>
            ))}
            {(slots ?? []).length === 0 && <li className="py-2 text-slate-600">No upcoming slots.</li>}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 font-semibold">{title}</h2>
      <Card className="p-0"><ul className="divide-y divide-slate-100">{children}</ul></Card>
    </section>
  );
}
const Empty = ({ children }: { children: React.ReactNode }) => <li className="px-5 py-3 text-sm text-slate-600">{children}</li>;

function Item({ v, children }: { v: Row; children: React.ReactNode }) {
  const resident = v.contacts?.residents;
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
      <div>
        <p className="font-medium">{resident?.full_name} <span className="text-sm font-normal text-slate-500">{resident?.booking_number}</span></p>
        <p className="text-sm text-slate-600">with {v.contacts?.users?.full_name} ({v.contacts?.relationship}) · <LocalTime iso={v.visit_slots.starts_at} /></p>
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </li>
  );
}
