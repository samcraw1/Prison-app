"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

export function EndVisitButton({ visitId, small = false }: { visitId: string; small?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function end() {
    setBusy(true);
    setError(undefined);
    const res = await fetch(`/api/visits/${visitId}/end`, { method: "POST" });
    if (!res.ok) {
      setError((await res.json().catch(() => null))?.error ?? "Could not end the visit.");
      setBusy(false);
      return;
    }
    router.replace("/staff/visits");
    router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-2">
      {error && <span role="alert" className="text-sm text-red-700">{error}</span>}
      <Button variant="danger" onClick={end} disabled={busy} className={small ? "py-1.5 text-sm" : ""}>{busy ? "Ending…" : "End visit"}</Button>
    </span>
  );
}
