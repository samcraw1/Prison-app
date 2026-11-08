import { useQuery } from "@tanstack/react-query";
import type { MessageStatus, RequestStatus, VisitStatus } from "@shared/status";
import { supabase } from "./supabase";

// Every query goes through the user's JWT, so the same RLS policies and security-definer functions
// that protect the website protect the app. Nothing here uses elevated privileges.

export type Contact = { contact_id: string; name: string; relationship: string };
export type ConnectionRequest = { id: string; typed_resident_name: string; relationship: string; status: RequestStatus; deny_reason: string | null; created_at: string };
export type Message = { id: string; sender: "family" | "resident"; body: string; status: MessageStatus; attachment_path: string | null; created_at: string; photo?: string };
export type Slot = { slot_id: string; starts_at: string; ends_at: string };
export type Visit = { id: string; status: VisitStatus; contact_id: string; deny_reason: string | null; visit_slots: { starts_at: string; ends_at: string } };

async function unwrap<T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return (data ?? ([] as unknown)) as T;
}

export const keys = {
  contacts: ["contacts"] as const,
  requests: ["requests"] as const,
  thread: (contactId: string) => ["thread", contactId] as const,
  visits: ["visits"] as const,
  slots: ["slots"] as const,
};

export const useContacts = () =>
  useQuery({ queryKey: keys.contacts, queryFn: () => unwrap<Contact[]>(supabase.rpc("list_my_contacts")) });

export const useRequests = () =>
  useQuery({
    queryKey: keys.requests,
    queryFn: () =>
      unwrap<ConnectionRequest[]>(
        supabase.from("connection_requests").select("id, typed_resident_name, relationship, status, deny_reason, created_at").order("created_at", { ascending: false }),
      ),
  });

export const useThread = (contactId: string) =>
  useQuery({
    queryKey: keys.thread(contactId),
    refetchInterval: 20_000, // fallback if realtime is unavailable
    queryFn: async () => {
      const rows = await unwrap<Message[]>(
        supabase.from("messages").select("id, sender, body, status, attachment_path, created_at").eq("contact_id", contactId).order("created_at", { ascending: false }).limit(200),
      );
      const paths = rows.map((m) => m.attachment_path).filter((p): p is string => !!p);
      if (paths.length) {
        const { data } = await supabase.storage.from("message-attachments").createSignedUrls(paths, 600);
        const byPath = new Map((data ?? []).map((d) => [d.path, d.signedUrl]));
        rows.forEach((m) => { if (m.attachment_path) m.photo = byPath.get(m.attachment_path) ?? undefined; });
      }
      return rows; // newest first, for an inverted list
    },
  });

export const useVisits = () =>
  useQuery({
    queryKey: keys.visits,
    refetchInterval: 30_000,
    queryFn: async () => {
      await supabase.rpc("expire_visits");
      const rows = await unwrap<Visit[]>(supabase.from("visits").select("id, status, contact_id, deny_reason, visit_slots(starts_at, ends_at)"));
      return [...rows].sort((a, b) => b.visit_slots.starts_at.localeCompare(a.visit_slots.starts_at));
    },
  });

export const useSlots = () => useQuery({ queryKey: keys.slots, queryFn: () => unwrap<Slot[]>(supabase.rpc("list_open_slots")) });

// Maps database errors to the same plain-language messages the website shows.
export function friendlyError(error: { code?: string; message?: string } | null | undefined, fallback: string) {
  if (!error) return fallback;
  if (error.message?.includes("unavailable")) return "Messaging is not available right now.";
  if (error.code === "P0001" && error.message) return error.message.charAt(0).toUpperCase() + error.message.slice(1) + ".";
  return fallback;
}
