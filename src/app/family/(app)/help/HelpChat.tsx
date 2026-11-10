"use client";

import { useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Button } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { HELP_DISCLAIMER, helpErrorText } from "@shared/help/errors";

const SUGGESTIONS = ["Why is my message held?", "How do video visits work?", "How do I connect with someone?"];

export function HelpChat() {
  const [input, setInput] = useState("");
  const [reported, setReported] = useState<Set<string>>(new Set());
  const { messages, sendMessage, status, error, clearError } = useChat({
    transport: new DefaultChatTransport({ api: "/api/help/chat" }),
  });
  const busy = status === "submitted" || status === "streaming";
  const errorText = helpErrorText(error);

  function ask(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    clearError();
    void sendMessage({ text: q.slice(0, 1000) });
    setInput("");
  }

  async function report(id: string) {
    setReported((s) => new Set(s).add(id));
    await createClient().rpc("report_help_answer");
  }

  return (
    <div className="space-y-4">
      <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">{HELP_DISCLAIMER}</p>

      {messages.length === 0 && (
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => ask(s)} className="rounded-full border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50">
              {s}
            </button>
          ))}
        </div>
      )}

      <ul className="space-y-3" aria-live="polite">
        {messages.map((m) => {
          const text = m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
          const mine = m.role === "user";
          return (
            <li key={m.id} className={mine ? "flex justify-end" : "flex justify-start"}>
              <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2 ${mine ? "bg-blue-800 text-white" : "bg-white ring-1 ring-slate-200"}`}>
                {text}
                {!mine && text && !busy && (
                  <div className="mt-1 text-right">
                    {reported.has(m.id) ? (
                      <span className="text-xs text-slate-500">Thanks, reported.</span>
                    ) : (
                      <button onClick={() => report(m.id)} className="text-xs text-slate-500 underline">Report answer</button>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
        {status === "submitted" && <li className="text-sm text-slate-500">Thinking…</li>}
      </ul>

      {errorText && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{errorText}</p>}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
        className="flex items-end gap-2"
      >
        <label className="flex-1">
          <span className="sr-only">Your question</span>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            maxLength={1000}
            placeholder="Ask a question"
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
          />
        </label>
        <Button type="submit" disabled={busy || !input.trim()}>Ask</Button>
      </form>
    </div>
  );
}
