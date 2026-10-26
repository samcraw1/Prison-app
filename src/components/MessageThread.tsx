import type { SupabaseClient } from "@supabase/supabase-js";

type Viewer = "family" | "resident";

export async function MessageThread({
  supabase,
  contactId,
  viewer,
  large = false,
}: {
  supabase: SupabaseClient;
  contactId: string;
  viewer: Viewer;
  large?: boolean;
}) {
  const { data } = await supabase
    .from("messages")
    .select("id, sender, body, status, attachment_path, created_at")
    .eq("contact_id", contactId)
    .order("created_at");

  const messages = await Promise.all(
    (data ?? []).map(async (m) => {
      let photo: string | undefined;
      if (m.attachment_path) {
        photo = (await supabase.storage.from("message-attachments").createSignedUrl(m.attachment_path, 300)).data?.signedUrl;
      }
      return { ...m, photo };
    }),
  );

  if (messages.length === 0) {
    return <p className={`py-8 text-center text-slate-500 ${large ? "text-xl" : ""}`}>No messages yet.</p>;
  }

  return (
    <ul className="space-y-3">
      {messages.map((m) => {
        const mine = m.sender === viewer;
        return (
          <li key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${mine ? "bg-blue-800 text-white" : "bg-white text-slate-900 border border-slate-200"} ${large ? "text-2xl" : ""}`}>
              <p className="whitespace-pre-wrap break-words">{m.body}</p>
              {m.photo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.photo} alt="Attached photo" className="mt-2 max-h-64 rounded-lg" />
              )}
              <p className={`mt-1 text-xs ${mine ? "text-blue-100" : "text-slate-500"} ${large ? "text-base" : ""}`}>
                {new Date(m.created_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                {mine && m.status === "held" && " · Waiting for staff review"}
                {mine && m.status === "rejected" && " · Not delivered"}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
