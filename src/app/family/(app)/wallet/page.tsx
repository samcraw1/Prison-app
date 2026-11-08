import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { Badge, Card } from "@/components/ui";
import { LocalTime } from "@/components/LocalTime";
import { AutoRefresh } from "@/components/AutoRefresh";
import { formatCents, ledgerDescription, type LedgerEntry } from "@shared/payments";
import { AddFunds } from "./AddFunds";

export const metadata = { title: "Balance" };

export default async function Wallet({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const { supabase } = await requireRole(["family"]);
  const [{ data: balance }, { data: entries }] = await Promise.all([
    supabase.rpc("my_balance"),
    supabase.from("ledger_entries").select("id, kind, amount_cents, note, created_at").order("id", { ascending: false }).limit(200).returns<LedgerEntry[]>(),
  ]);
  const cents = Number(balance ?? 0);
  const payments = !!process.env.STRIPE_SECRET_KEY;

  return (
    <div className="space-y-6">
      {/* The webhook credits the ledger; realtime refreshes this page when it lands. */}
      <AutoRefresh seconds={30} live={["ledger_entries"]} />
      <Link href="/family" className="text-sm text-blue-800 underline">← Back</Link>

      {status === "success" && (
        <p role="status" className="rounded-lg bg-green-50 px-4 py-3 text-green-900">
          Thanks. Your payment is being confirmed; your balance updates in a moment.
        </p>
      )}
      {status === "cancelled" && <p role="status" className="rounded-lg bg-slate-100 px-4 py-3 text-slate-700">Payment cancelled. You were not charged.</p>}

      <Card>
        <h1 className="text-xl font-semibold">Your balance</h1>
        <p className={`mt-2 text-4xl font-semibold ${cents < 0 ? "text-red-700" : "text-slate-900"}`}>{formatCents(cents)}</p>
        <p className="mt-2 text-sm text-slate-600">
          Facilities set their own prices for messages and video visits. Fees for messages that aren&apos;t delivered and
          visits that don&apos;t take place are refunded to this balance.
        </p>
        <div className="mt-5">
          {payments ? <AddFunds /> : <p className="text-slate-600">Adding funds is not available yet.</p>}
        </div>
      </Card>

      <Card>
        <h2 className="font-semibold">History</h2>
        {entries?.length ? (
          <ul className="mt-3 divide-y divide-slate-100">
            {entries.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 py-3">
                <div>
                  <div className="font-medium">{ledgerDescription(e)}</div>
                  <div className="text-sm text-slate-500"><LocalTime iso={e.created_at} /></div>
                </div>
                <Badge tone={e.amount_cents > 0 ? "green" : "slate"}>{e.amount_cents > 0 ? "+" : ""}{formatCents(e.amount_cents)}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-slate-600">No activity yet.</p>
        )}
      </Card>
    </div>
  );
}
