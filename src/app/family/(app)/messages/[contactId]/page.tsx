import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { Card } from "@/components/ui";
import { MessageThread } from "@/components/MessageThread";
import { Compose } from "@/components/Compose";
import { AutoRefresh } from "@/components/AutoRefresh";
import { formatCents } from "@shared/payments";

export default async function FamilyThread({ params }: { params: Promise<{ contactId: string }> }) {
  const { contactId } = await params;
  const { supabase } = await requireRole(["family"]);
  const { data: contacts } = await supabase.rpc("list_my_contacts");
  const contact = ((contacts ?? []) as { contact_id: string; name: string }[]).find((c) => c.contact_id === contactId);
  if (!contact) notFound();
  const { data: prices } = await supabase.rpc("contact_prices", { p_contact: contactId }).maybeSingle<{ message_fee_cents: number; free_messages_left: number }>();
  const priceNote = prices && prices.message_fee_cents > 0
    ? `Each message costs ${formatCents(prices.message_fee_cents)}${prices.free_messages_left > 0 ? ` (${prices.free_messages_left} free left this week)` : ""}.`
    : null;

  return (
    <div className="space-y-4">
      <AutoRefresh live={["messages", "ledger_entries"]} />
      <Link href="/family" className="text-sm text-blue-800 underline">← Back</Link>
      <h1 className="text-xl font-semibold">Messages with {contact.name}</h1>
      <MessageThread supabase={supabase} contactId={contactId} viewer="family" />
      <Card>
        <Compose contactId={contactId} allowPhoto />
        {priceNote && <p className="mt-2 text-xs text-slate-500">{priceNote} <Link href="/family/wallet" className="underline">Balance</Link></p>}
      </Card>
    </div>
  );
}
