"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type LiveTable = "messages" | "visits" | "connection_requests" | "contacts";

// Keeps a server-rendered page current. With `live`, a Supabase Realtime change on those tables (filtered by
// the viewer's RLS) refreshes the page immediately; polling stays on as a fallback if realtime is unavailable.
export function AutoRefresh({ seconds = 10, live = [] }: { seconds?: number; live?: LiveTable[] }) {
  const router = useRouter();
  const liveKey = live.join(",");

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);

  useEffect(() => {
    if (!liveKey) return;
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 250); // coalesce bursts
    };
    const channel = supabase.channel(`live:${liveKey}:${Math.random().toString(36).slice(2)}`);
    for (const table of liveKey.split(",")) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, refresh);
    }
    channel.subscribe();
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [router, liveKey]);

  return null;
}
