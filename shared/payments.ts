// Shared between the Next.js web app and the Expo app. Pure TypeScript: no framework imports.
// Prices and balances are decided by the database (supabase/migrations/20261108000003_payments.sql); these are
// display helpers and the fixed set of deposit amounts the checkout route accepts.

export const DEPOSIT_AMOUNTS_CENTS = [1000, 2500, 5000] as const;
export type DepositAmount = (typeof DEPOSIT_AMOUNTS_CENTS)[number];

export type LedgerKind = "deposit" | "message_fee" | "visit_fee" | "refund" | "adjustment";
export type LedgerEntry = { id: number; kind: LedgerKind; amount_cents: number; note: string | null; created_at: string };

const LABEL: Record<LedgerKind, string> = {
  deposit: "Added funds",
  message_fee: "Message",
  visit_fee: "Video visit",
  refund: "Refund",
  adjustment: "Adjustment",
};

export function formatCents(cents: number | string | null | undefined): string {
  const n = Number(cents ?? 0);
  return `${n < 0 ? "-" : ""}$${(Math.abs(n) / 100).toFixed(2)}`;
}

// One line describing a ledger row in a history list.
export function ledgerDescription(e: Pick<LedgerEntry, "kind" | "note">): string {
  if (e.kind === "refund") return e.note === "card refund" ? "Card refund" : `Refund${e.note ? `: ${e.note}` : ""}`;
  if (e.kind === "adjustment" && e.note) return e.note.charAt(0).toUpperCase() + e.note.slice(1);
  return LABEL[e.kind];
}

// The database raises P0001 "insufficient balance; add funds to continue" when a fee can't be paid.
export function isInsufficientBalance(error: { code?: string; message?: string } | null | undefined): boolean {
  return !!error && error.code === "P0001" && !!error.message?.includes("insufficient balance");
}
