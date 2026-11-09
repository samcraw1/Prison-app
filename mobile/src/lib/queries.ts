import { useQuery } from "@tanstack/react-query";
import type { EndReason, MessageStatus, RequestStatus, VisitStatus } from "@shared/status";
import { isInsufficientBalance, type LedgerEntry } from "@shared/payments";
import { supabase } from "./supabase";

// Every query goes through the user's JWT, so the same RLS policies and security-definer functions
// that protect the website protect the app. Nothing here uses elevated privileges.

export type Contact = { contact_id: string; name: string; relationship: string };
export type ConnectionRequest = { id: string; typed_resident_name: string; relationship: string; status: RequestStatus; deny_reason: string | null; created_at: string };
export type Message = { id: string; sender: "family" | "resident"; body: string; status: MessageStatus; attachment_path: string | null; created_at: string; photo?: string };
export type Slot = { slot_id: string; starts_at: string; ends_at: string };
export type Visit = { id: string; status: VisitStatus; end_reason: EndReason; contact_id: string; deny_reason: string | null; visit_slots: { starts_at: string; ends_at: string } };

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
  latestIncoming: ["latest-incoming"] as const,
  facilities: ["connect-facilities"] as const,
  balance: ["wallet", "balance"] as const,
  deletion: ["account", "deletion"] as const,
  blocked: ["blocked-contacts"] as const,
  ledger: ["wallet", "ledger"] as const,
  prices: (contactId: string) => ["wallet", "prices", contactId] as const,
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
      const rows = await unwrap<Visit[]>(supabase.from("visits").select("id, status, end_reason, contact_id, deny_reason, visit_slots(starts_at, ends_at)"));
      return [...rows].sort((a, b) => b.visit_slots.starts_at.localeCompare(a.visit_slots.starts_at));
    },
  });

// Open slots at the chosen contact's facility (contacts can be at different facilities).
export const useSlots = (contactId: string | undefined) =>
  useQuery({
    queryKey: [...keys.slots, contactId],
    enabled: !!contactId,
    queryFn: () => unwrap<Slot[]>(supabase.rpc("list_open_slots_for_contact", { p_contact: contactId })),
  });

export type Facility = { id: string; name: string; slug: string };
// Facilities a family can connect with (names only).
export const useConnectFacilities = () =>
  useQuery({ queryKey: keys.facilities, staleTime: 10 * 60_000, queryFn: () => unwrap<Facility[]>(supabase.rpc("list_connect_facilities")) });

// Maps database errors to the same plain-language messages the website shows.
export function friendlyError(error: { code?: string; message?: string } | null | undefined, fallback: string) {
  if (!error) return fallback;
  if (error.message?.includes("unavailable")) return "Messaging is not available right now.";
  if (isInsufficientBalance(error)) return "Your balance is too low for this.";
  if (error.code === "P0001" && error.message) return error.message.charAt(0).toUpperCase() + error.message.slice(1) + ".";
  return fallback;
}

// Newest delivered resident message per contact. RLS only lets a family member see resident messages after
// staff deliver them, so held messages never count as new.
export const useLatestIncoming = () =>
  useQuery({
    queryKey: keys.latestIncoming,
    queryFn: async () => {
      const rows = await unwrap<{ contact_id: string; delivered_at: string | null; created_at: string }[]>(
        supabase.from("messages").select("contact_id, delivered_at, created_at").eq("sender", "resident").eq("status", "delivered")
          .order("delivered_at", { ascending: false }).limit(300),
      );
      const latest: Record<string, string> = {};
      for (const r of rows) {
        const at = r.delivered_at ?? r.created_at;
        if (!latest[r.contact_id] || at > latest[r.contact_id]) latest[r.contact_id] = at;
      }
      return latest;
    },
  });

// ------------------------------------------------------------------ balance
// The balance is computed in the database from the append-only ledger; the app never adds anything up itself.
export const useBalance = () =>
  useQuery({ queryKey: keys.balance, queryFn: async () => Number(await unwrap<number>(supabase.rpc("my_balance"))) });

export type BlockedContact = { contact_id: string; name: string };
export const useBlocked = () =>
  useQuery({ queryKey: keys.blocked, queryFn: () => unwrap<BlockedContact[]>(supabase.rpc("list_blocked_contacts")) });

// When this account will be deleted (30-day grace period), or null.
export const useDeletion = () =>
  useQuery({ queryKey: keys.deletion, queryFn: async () => (await unwrap<string | null>(supabase.rpc("my_deletion"))) ?? null });

export const useLedger = () =>
  useQuery({
    queryKey: keys.ledger,
    queryFn: () => unwrap<LedgerEntry[]>(
      supabase.from("ledger_entries").select("id, kind, amount_cents, note, created_at").order("id", { ascending: false }).limit(200),
    ),
  });

export type Prices = { message_fee_cents: number; visit_fee_cents: number; free_messages_left: number };
// Prices set by the contact's (resident's) facility.
export const useContactPrices = (contactId: string | undefined) =>
  useQuery({
    queryKey: keys.prices(contactId ?? ""),
    enabled: !!contactId,
    queryFn: async () => (await unwrap<Prices[]>(supabase.rpc("contact_prices", { p_contact: contactId })))[0] ?? null,
  });
