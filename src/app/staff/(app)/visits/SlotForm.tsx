"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ErrorText, Field } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

export function SlotForm({ maxMinutes }: { maxMinutes: number }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(undefined);
    const f = new FormData(e.currentTarget);
    const when = new Date(String(f.get("starts"))); // interpreted in the staff member's own time zone
    if (Number.isNaN(when.getTime())) return setError("Pick a date and time.");
    setBusy(true);
    const { error } = await createClient().rpc("create_slot", {
      p_starts: when.toISOString(), p_minutes: Number(f.get("minutes")), p_capacity: Number(f.get("capacity")),
    });
    setBusy(false);
    if (error) return setError(error.message);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <Field label="Start" name="starts" type="datetime-local" required />
      <div className="grid grid-cols-2 gap-3">
        <Field label={`Minutes (5–${maxMinutes})`} name="minutes" type="number" min={5} max={maxMinutes} defaultValue={Math.min(30, maxMinutes)} required />
        <Field label="Calls at once" name="capacity" type="number" min={1} max={20} defaultValue={1} required />
      </div>
      <ErrorText>{error}</ErrorText>
      <Button type="submit" disabled={busy} className="w-full">{busy ? "Adding…" : "Add time slot"}</Button>
    </form>
  );
}
