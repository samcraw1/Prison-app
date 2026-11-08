import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { Badge, Card } from "@/components/ui";
import { LocalTime } from "@/components/LocalTime";
import { AutoRefresh } from "@/components/AutoRefresh";
import { RequestVisit } from "./RequestVisit";
import { CancelVisit } from "./CancelVisit";
import { VISIT_LABEL, VISIT_TONE, type VisitStatus } from "@shared/status";
import { formatCents } from "@shared/payments";

export const metadata = { title: "Video visits" };

const TONE = VISIT_TONE;
const LABEL = VISIT_LABEL;

type VisitRow = {
  id: string;
  status: VisitStatus;
  contact_id: string;
  deny_reason: string | null;
  visit_slots: { starts_at: string; ends_at: string };
};

export default async function FamilyVisits() {
  const { supabase } = await requireRole(["family"]);
  await supabase.rpc("expire_visits");
  const [{ data: contactData }, { data: slotData }, { data: visitData }] = await Promise.all([
    supabase.rpc("list_my_contacts"),
    supabase.rpc("list_open_slots"),
    supabase.from("visits").select("id, status, contact_id, deny_reason, visit_slots(starts_at, ends_at)").returns<VisitRow[]>(),
  ]);
  const contacts = (contactData ?? []) as { contact_id: string; name: string }[];
  const slots = (slotData ?? []) as { slot_id: string; starts_at: string; ends_at: string }[];
  // Visit prices are set by each resident's facility.
  const visitFee = new Map(await Promise.all(contacts.map(async (c) => {
    const { data } = await supabase.rpc("contact_prices", { p_contact: c.contact_id }).maybeSingle<{ visit_fee_cents: number }>();
    return [c.contact_id, data?.visit_fee_cents ?? 0] as const;
  })));
  const nameOf = (id: string) => contacts.find((c) => c.contact_id === id)?.name ?? "Resident";
  const visits = [...(visitData ?? [])].sort((a, b) => b.visit_slots.starts_at.localeCompare(a.visit_slots.starts_at));
  const now = Date.now();

  return (
    <div className="space-y-6">
      <AutoRefresh seconds={30} live={["visits", "ledger_entries"]} />
      <Link href="/family" className="text-sm text-blue-800 underline">← Back</Link>
      <Card>
        <h1 className="mb-3 text-xl font-semibold">Request a video visit</h1>
        {[...visitFee.values()].some((f) => f > 0) && (
          <p className="mb-3 text-sm text-slate-600">
            {contacts.length === 1 ? `Each visit costs ${formatCents(visitFee.get(contacts[0].contact_id))}. ` : "Prices are shown next to each person. "}
            The fee is refunded if the visit is not approved or doesn&apos;t take place. <Link href="/family/wallet" className="underline">Balance</Link>
          </p>
        )}
        <RequestVisit
          contacts={contacts.map((c) => ({ id: c.contact_id, label: visitFee.get(c.contact_id) ? `${c.name} (${formatCents(visitFee.get(c.contact_id))} per visit)` : c.name }))}
          slots={slots.map((s) => ({
            id: s.slot_id,
            label: `${new Date(s.starts_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })} (${Math.round((new Date(s.ends_at).getTime() - new Date(s.starts_at).getTime()) / 60000)} min)`,
          }))}
        />
      </Card>
      <Card>
        <h2 className="font-semibold">Your visits</h2>
        <ul className="mt-3 divide-y divide-slate-100">
          {visits.map((v) => {
            const joinable = ["approved", "live"].includes(v.status) && now >= new Date(v.visit_slots.starts_at).getTime() - 5 * 60_000 && now <= new Date(v.visit_slots.ends_at).getTime();
            return (
              <li key={v.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-medium">{nameOf(v.contact_id)}</p>
                  <p className="text-sm text-slate-600"><LocalTime iso={v.visit_slots.starts_at} /></p>
                  {v.deny_reason && <p className="text-sm text-slate-600">Reason: {v.deny_reason}</p>}
                </div>
                <div className="flex items-center gap-3">
                  <Badge tone={TONE[v.status]}>{LABEL[v.status]}</Badge>
                  {joinable && <Link href={`/family/visits/${v.id}`} className="rounded-lg bg-blue-800 px-4 py-2 text-sm font-medium text-white">Join</Link>}
                  {["requested", "approved"].includes(v.status) && !joinable && <CancelVisit visitId={v.id} />}
                </div>
              </li>
            );
          })}
          {visits.length === 0 && <li className="py-3 text-slate-600">No visits yet.</li>}
        </ul>
      </Card>
    </div>
  );
}
