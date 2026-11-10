// The help chat route answers errors as JSON `{ error }`. useChat surfaces the raw body as the error message.
export function helpErrorText(error: Error | undefined): string | null {
  if (!error) return null;
  try {
    const parsed = JSON.parse(error.message) as { error?: unknown };
    if (typeof parsed.error === "string") return parsed.error;
  } catch {
    // not JSON (network error, etc.)
  }
  return "Help isn't available right now. Please try again later.";
}

export const HELP_DISCLAIMER =
  "Answers come from AI using the facility's published rules and FAQs. They can be wrong. This assistant can't see your messages or account and can't give legal advice.";
