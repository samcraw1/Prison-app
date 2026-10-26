"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Simple polling so new messages show up without a manual reload.
// A production build would use Supabase Realtime instead.
export function AutoRefresh({ seconds = 10 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}
