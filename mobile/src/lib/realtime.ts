import { useEffect } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { supabase } from "./supabase";

type Table = "messages" | "visits" | "connection_requests" | "contacts";

// Subscribes to row changes the signed-in user is allowed to see (Realtime applies the same RLS SELECT
// policies) and refetches the affected queries. Payloads are only used as a signal; data is re-read over RLS.
export function useLiveQuery(table: Table, queryKeys: QueryKey[], filter?: string) {
  const qc = useQueryClient();
  const keyStr = JSON.stringify(queryKeys);
  useEffect(() => {
    const channel = supabase
      .channel(`live:${table}:${filter ?? "all"}:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table, ...(filter ? { filter } : {}) }, () => {
        (JSON.parse(keyStr) as QueryKey[]).forEach((queryKey) => qc.invalidateQueries({ queryKey }));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [table, filter, keyStr, qc]);
}
