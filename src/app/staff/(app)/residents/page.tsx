import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { Badge, Button, Card, Field } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { createResident } from "./actions";

export const metadata = { title: "Residents" };

export default async function ResidentsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const { supabase } = await requireRole(["staff", "admin"]);
  let query = supabase.from("residents").select("id, full_name, booking_number, housing_unit, comms_suspended, pin_failures").order("full_name");
  const term = q?.trim().replace(/[%,()]/g, "");
  if (term) query = query.or(`full_name.ilike.%${term}%,booking_number.ilike.%${term}%`);
  const { data: residents } = await query;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Residents</h1>
        <form className="flex gap-2">
          <input name="q" defaultValue={q} placeholder="Search name or booking number" className="flex-1 rounded-lg border border-slate-300 px-3 py-2" />
          <Button variant="secondary">Search</Button>
        </form>
        <Card className="p-0">
          <ul className="divide-y divide-slate-100">
            {(residents ?? []).map((r) => (
              <li key={r.id}>
                <Link href={`/staff/residents/${r.id}`} className="flex items-center justify-between px-5 py-3 hover:bg-slate-50">
                  <span>
                    <span className="font-medium">{r.full_name}</span>
                    <span className="ml-2 text-sm text-slate-500">{r.booking_number}{r.housing_unit ? ` · ${r.housing_unit}` : ""}</span>
                  </span>
                  <span className="flex gap-2">
                    {r.pin_failures >= 5 && <Badge tone="amber">Locked</Badge>}
                    {r.comms_suspended && <Badge tone="red">Suspended</Badge>}
                  </span>
                </Link>
              </li>
            ))}
            {(residents ?? []).length === 0 && <li className="px-5 py-4 text-slate-600">No residents found.</li>}
          </ul>
        </Card>
      </div>
      <Card className="h-fit">
        <h2 className="font-semibold">Add a resident</h2>
        <p className="mt-1 text-sm text-slate-600">A one-time PIN is created for the resident.</p>
        <ActionForm action={createResident} className="mt-4 space-y-3">
          <Field label="Full name" name="fullName" required minLength={2} maxLength={100} />
          <Field label="Booking number" name="booking" required pattern="[A-Za-z0-9\-]{3,20}" />
          <Field label="Housing unit (optional)" name="housingUnit" maxLength={20} />
          <Button type="submit" className="w-full">Add resident</Button>
        </ActionForm>
      </Card>
    </div>
  );
}
