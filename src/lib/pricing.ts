// Extension point for per-message pricing. The MVP charges nothing.
// A production version would compute the fee here (facility rate card, contact type, attachments)
// and persist it in `messages.fee_cents` from the `send_message` database function, so the
// charge is decided server-side and cannot be skipped by a client.
export interface MessageFeeContext {
  facilityId: string;
  sender: "family" | "resident";
  hasAttachment: boolean;
}

export function getMessageFee(_ctx: MessageFeeContext): number {
  return 0;
}
