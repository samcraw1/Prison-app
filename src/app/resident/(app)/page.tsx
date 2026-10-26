import Link from "next/link";
import { requireRole } from "@/lib/auth";

export default async function ResidentHome() {
  const { supabase } = await requireRole(["resident"]);
  const { data } = await supabase.rpc("list_my_contacts");
  const contacts = (data ?? []) as { contact_id: string; name: string; relationship: string }[];

  return (
    <div>
      <h1 className="text-3xl font-semibold">Who do you want to talk to?</h1>
      {contacts.length === 0 ? (
        <p className="mt-6 text-xl text-slate-600">You have no approved contacts yet. Ask your family to send a request.</p>
      ) : (
        <ul className="mt-6 space-y-4">
          {contacts.map((c) => (
            <li key={c.contact_id}>
              <Link
                href={`/resident/messages/${c.contact_id}`}
                className="flex items-center gap-5 rounded-2xl border-2 border-slate-300 bg-white p-6 text-2xl font-medium active:bg-slate-100"
              >
                <span aria-hidden className="text-4xl">✉️</span>
                <span>{c.name}<span className="block text-lg font-normal text-slate-500">{c.relationship}</span></span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
