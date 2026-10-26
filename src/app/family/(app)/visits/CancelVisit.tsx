"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function CancelVisit({ visitId }: { visitId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await createClient().rpc("cancel_visit", { p_visit: visitId });
        router.refresh();
      }}
      className="text-sm text-red-700 underline disabled:opacity-50"
    >
      Cancel
    </button>
  );
}
