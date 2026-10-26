import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { LocalTime } from "@/components/LocalTime";
import { AutoRefresh } from "@/components/AutoRefresh";

export const metadata = { title: "Video visits" };

type VisitRow = { id: string; status: string; contact_id: string; visit_slots: { starts_at: string; ends_at: string } };

export default async function ResidentVisits() {
  const { supabase } = await requireRole(["resident"]);
  await supabase.rpc("expire_visits");
  const [{ data: contactData }, { data: visitData }] = await Promise.all([
    supabase.rpc("list_my_contacts"),
    supabase.from("visits").select("id, status, contact_id, visit_slots(starts_at, ends_at)").in("status", ["approved", "live"]).returns<VisitRow[]>(),
  ]);
  const contacts = (contactData ?? []) as { contact_id: string; name: string }[];
  const visits = [...(visitData ?? [])].sort((a, b) => a.visit_slots.starts_at.localeCompare(b.visit_slots.starts_at));
  const now = Date.now();

  return (
    <div className="space-y-6">
      <AutoRefresh seconds={20} />
      <Link href="/resident" className="text-xl text-blue-800 underline">← Back</Link>
      <h1 className="text-3xl font-semibold">Video visits</h1>
      {visits.length === 0 && <p className="text-xl text-slate-600">You have no visits planned.</p>}
      <ul className="space-y-4">
        {visits.map((v) => {
          const start = new Date(v.visit_slots.starts_at).getTime();
          const end = new Date(v.visit_slots.ends_at).getTime();
          const joinable = now >= start - 5 * 60_000 && now <= end;
          return (
            <li key={v.id} className="rounded-2xl border-2 border-slate-300 bg-white p-6">
              <p className="text-2xl font-medium">{contacts.find((c) => c.contact_id === v.contact_id)?.name}</p>
              <p className="mt-1 text-xl text-slate-600"><LocalTime iso={v.visit_slots.starts_at} /></p>
              {joinable ? (
                <Link href={`/resident/visits/${v.id}`} className="mt-4 inline-block rounded-xl bg-blue-800 px-8 py-4 text-2xl font-semibold text-white">Join the visit</Link>
              ) : (
                <p className="mt-3 text-lg text-slate-500">You can join 5 minutes before the start.</p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
