// Shared between the Next.js web app and the Expo app. Pure TypeScript: no framework imports.

export type VisitStatus = "requested" | "approved" | "denied" | "live" | "ended" | "cancelled";
export type MessageStatus = "held" | "delivered" | "rejected";
export type RequestStatus = "pending" | "approved" | "denied";
export type Tone = "amber" | "green" | "red" | "slate";

export const VISIT_LABEL: Record<VisitStatus, string> = {
  requested: "Waiting for staff",
  approved: "Approved",
  live: "In progress",
  denied: "Not approved",
  ended: "Finished",
  cancelled: "Cancelled",
};
export const VISIT_TONE: Record<VisitStatus, Tone> = {
  requested: "amber",
  approved: "green",
  live: "green",
  denied: "red",
  ended: "slate",
  cancelled: "slate",
};

// Same window the join route enforces (src/app/api/visits/[id]/join/route.ts).
export const EARLY_JOIN_MS = 5 * 60_000;
export function isJoinable(status: VisitStatus, startsAt: string, endsAt: string, now = Date.now()) {
  return (status === "approved" || status === "live") && now >= new Date(startsAt).getTime() - EARLY_JOIN_MS && now <= new Date(endsAt).getTime();
}
export function canCancel(status: VisitStatus, joinable: boolean) {
  return (status === "requested" || status === "approved") && !joinable;
}

export const PHOTO_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_MESSAGE_CHARS = 2000;

export function messageStatusNote(status: MessageStatus): string | null {
  if (status === "held") return "Waiting for staff review";
  if (status === "rejected") return "Not delivered";
  return null;
}

// ---------------------------------------------------------------------------------------------------------
// Visit presentation. Mirrors the backend: expire_visits() turns an un-joined approved visit into
// cancelled/no_show and an undecided request into cancelled/expired; end_visit() sets ended/staff; a live visit
// that runs out becomes ended/time. Joinability matches the join route (approved or live, from 5 minutes
// before start until the end of the slot). The server re-checks everything on join.

export type EndReason = "staff" | "time" | "cancelled" | "no_show" | "expired" | null;
export type VisitPhase =
  | "pending" | "upcoming" | "ready" | "live" | "completed" | "ended_by_staff"
  | "missed" | "cancelled" | "not_reviewed" | "denied";

export const VISIT_PHASE: Record<VisitPhase, { label: string; tone: Tone; past: boolean }> = {
  pending: { label: "Waiting for staff", tone: "amber", past: false },
  upcoming: { label: "Approved", tone: "green", past: false },
  ready: { label: "Ready to join", tone: "green", past: false },
  live: { label: "In progress", tone: "green", past: false },
  completed: { label: "Completed", tone: "slate", past: true },
  ended_by_staff: { label: "Ended by staff", tone: "slate", past: true },
  missed: { label: "Missed", tone: "red", past: true },
  cancelled: { label: "Cancelled", tone: "slate", past: true },
  not_reviewed: { label: "Not reviewed in time", tone: "slate", past: true },
  denied: { label: "Not approved", tone: "red", past: true },
};

export function visitPhase(v: { status: VisitStatus; end_reason?: EndReason; starts_at: string; ends_at: string }, now = Date.now()): VisitPhase {
  const ended = now > new Date(v.ends_at).getTime();
  switch (v.status) {
    case "requested":
      return now >= new Date(v.starts_at).getTime() ? "not_reviewed" : "pending";
    case "approved":
      if (ended) return "missed"; // expire_visits() will record it as no_show
      return isJoinable("approved", v.starts_at, v.ends_at, now) ? "ready" : "upcoming";
    case "live":
      return ended ? "completed" : "live";
    case "ended":
      return v.end_reason === "staff" ? "ended_by_staff" : "completed";
    case "cancelled":
      return v.end_reason === "no_show" ? "missed" : v.end_reason === "expired" ? "not_reviewed" : "cancelled";
    case "denied":
      return "denied";
  }
}

export function minutesBetween(startIso: string, endIso: string) {
  return Math.max(1, Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000));
}
