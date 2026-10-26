import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { Card } from "@/components/ui";
import { MessageThread } from "@/components/MessageThread";
import { Compose } from "@/components/Compose";
import { AutoRefresh } from "@/components/AutoRefresh";

export default async function FamilyThread({ params }: { params: Promise<{ contactId: string }> }) {
  const { contactId } = await params;
  const { supabase } = await requireRole(["family"]);
  const { data: contacts } = await supabase.rpc("list_my_contacts");
  const contact = ((contacts ?? []) as { contact_id: string; name: string }[]).find((c) => c.contact_id === contactId);
  if (!contact) notFound();

  return (
    <div className="space-y-4">
      <AutoRefresh />
      <Link href="/family" className="text-sm text-blue-800 underline">← Back</Link>
      <h1 className="text-xl font-semibold">Messages with {contact.name}</h1>
      <MessageThread supabase={supabase} contactId={contactId} viewer="family" />
      <Card><Compose contactId={contactId} allowPhoto /></Card>
    </div>
  );
}
