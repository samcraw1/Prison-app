"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const MAX_BYTES = 5 * 1024 * 1024;

export function Compose({ contactId, allowPhoto = false, large = false }: { contactId: string; allowPhoto?: boolean; large?: boolean }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [body, setBody] = useState("");
  const [fileName, setFileName] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function send() {
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(undefined);
    const supabase = createClient();

    let path: string | null = null;
    const file = fileRef.current?.files?.[0];
    if (file) {
      if (!TYPES[file.type] || file.size > MAX_BYTES) {
        setBusy(false);
        return setError("Photos must be JPG, PNG or WebP, up to 5 MB.");
      }
      const { data: me } = await supabase.from("users").select("id, facility_id").single();
      if (!me) {
        setBusy(false);
        return setError("Please sign in again.");
      }
      path = `${me.facility_id}/${me.id}/${crypto.randomUUID()}.${TYPES[file.type]}`;
      const up = await supabase.storage.from("message-attachments").upload(path, file, { contentType: file.type });
      if (up.error) {
        setBusy(false);
        return setError("Could not upload the photo.");
      }
    }

    const { error: rpcError } = await supabase.rpc("send_message", { p_contact: contactId, p_body: text, p_attachment_path: path });
    setBusy(false);
    if (rpcError) {
      return setError(rpcError.message.includes("unavailable") ? "Messaging is not available right now." : "Could not send. Please try again.");
    }
    setBody("");
    setFileName(undefined);
    if (fileRef.current) fileRef.current.value = "";
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={2000}
        rows={large ? 4 : 3}
        placeholder="Write a message"
        aria-label="Message"
        className={`w-full rounded-xl border-2 border-slate-300 p-3 focus:border-blue-700 focus:outline-none ${large ? "text-2xl" : ""}`}
      />
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={send}
          disabled={busy || !body.trim()}
          className={`rounded-xl bg-blue-800 font-semibold text-white disabled:opacity-40 ${large ? "px-8 py-4 text-2xl" : "px-5 py-2.5"}`}
        >
          {busy ? "Sending…" : "Send"}
        </button>
        {allowPhoto && (
          <>
            <button type="button" onClick={() => fileRef.current?.click()} className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">
              Add photo
            </button>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => setFileName(e.target.files?.[0]?.name)} />
            {fileName && <span className="truncate text-sm text-slate-600">{fileName}</span>}
          </>
        )}
      </div>
      <p className="text-xs text-slate-500">All messages are reviewed by facility staff.</p>
    </div>
  );
}
