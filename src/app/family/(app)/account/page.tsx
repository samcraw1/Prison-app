import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { Card } from "@/components/ui";
import { formatCents } from "@shared/payments";
import { DeleteAccount } from "./DeleteAccount";

export const metadata = { title: "Account" };

export default async function Account() {
  const { supabase, profile } = await requireRole(["family"]);
  const [{ data: balance }, { data: scheduled }] = await Promise.all([supabase.rpc("my_balance"), supabase.rpc("my_deletion")]);
  return (
    <div className="space-y-6">
      <Link href="/family" className="text-sm text-blue-800 underline">← Back</Link>
      <Card>
        <h1 className="text-xl font-semibold">Account</h1>
        <p className="mt-2 text-slate-700">{profile.full_name}</p>
        <p className="text-sm text-slate-600">{profile.email}</p>
      </Card>
      <DeleteAccount email={profile.email} balanceLabel={formatCents(Number(balance ?? 0))} balanceCents={Number(balance ?? 0)} scheduledFor={(scheduled as string | null) ?? null} />
    </div>
  );
}
