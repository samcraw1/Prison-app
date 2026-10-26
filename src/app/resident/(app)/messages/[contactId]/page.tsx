import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { MessageThread } from "@/components/MessageThread";
import { Compose } from "@/components/Compose";
import { AutoRefresh } from "@/components/AutoRefresh";

export default async function ResidentThread({ params }: { params: Promise<{ contactId: string }> }) {
  const { contactId } = await params;
  const { supabase } = await requireRole(["resident"]);
  const { data: contacts } = await supabase.rpc("list_my_contacts");
  const contact = ((contacts ?? []) as { contact_id: string; name: string }[]).find((c) => c.contact_id === contactId);
  if (!contact) notFound();

  return (
    <div className="space-y-6">
      <AutoRefresh />
      <Link href="/resident" className="text-xl text-blue-800 underline">← Back</Link>
      <h1 className="text-3xl font-semibold">{contact.name}</h1>
      <MessageThread supabase={supabase} contactId={contactId} viewer="resident" large />
      <Compose contactId={contactId} large />
    </div>
  );
}
