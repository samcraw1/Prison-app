"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ErrorText } from "@/components/ui";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { isInsufficientBalance } from "@shared/payments";

type Opt = { id: string; label: string };

export function RequestVisit({ contacts, slots }: { contacts: Opt[]; slots: Opt[] }) {
  const router = useRouter();
  const [contactId, setContactId] = useState(contacts[0]?.id ?? "");
  const [slotId, setSlotId] = useState(slots[0]?.id ?? "");
  const [error, setError] = useState<string>();
  const [needsFunds, setNeedsFunds] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(undefined);
    const { error } = await createClient().rpc("request_visit", { p_contact: contactId, p_slot: slotId });
    setBusy(false);
    setNeedsFunds(isInsufficientBalance(error));
    if (error) return setError(isInsufficientBalance(error) ? "Your balance is too low to request this visit." : error.code === "P0001" ? error.message : "Could not request that visit.");
    router.refresh();
  }

  if (contacts.length === 0) return <p className="text-slate-600">You need an approved connection before you can request a visit.</p>;
  if (slots.length === 0) return <p className="text-slate-600">No visit times are open right now. Please check back later.</p>;

  return (
    <div className="space-y-3">
      {contacts.length > 1 && (
        <label className="block text-sm font-medium">Who are you visiting?
          <select value={contactId} onChange={(e) => setContactId(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal">
            {contacts.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
      )}
      <label className="block text-sm font-medium">Pick a time
        <select value={slotId} onChange={(e) => setSlotId(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal">
          {slots.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </label>
      <ErrorText>{error}{needsFunds && <> <Link href="/family/wallet" className="font-medium underline">Add funds</Link></>}</ErrorText>
      <Button onClick={submit} disabled={busy}>{busy ? "Sending…" : "Request visit"}</Button>
    </div>
  );
}
