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
