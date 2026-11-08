import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export type Profile = { id: string; full_name: string; email: string; facility_id: string; role: string; status: string };
type AuthState = { ready: boolean; session: Session | null; profile: Profile | null; refreshProfile: () => Promise<void> };

const Ctx = createContext<AuthState>({ ready: false, session: null, profile: null, refreshProfile: async () => {} });

async function loadProfile(userId: string) {
  const { data } = await supabase.from("users").select("id, full_name, email, facility_id, role, status").eq("id", userId).maybeSingle();
  return (data as Profile | null) ?? null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    let mounted = true;
    const apply = async (s: Session | null) => {
      const p = s ? await loadProfile(s.user.id) : null;
      // The mobile app is for family and friends. Staff and residents use the web console and kiosk.
      if (s && (!p || p.role !== "family" || p.status !== "active")) {
        await supabase.auth.signOut();
        if (mounted) { setSession(null); setProfile(null); setReady(true); }
        return;
      }
      if (mounted) { setSession(s); setProfile(p); setReady(true); }
    };
    supabase.auth.getSession().then(({ data }) => apply(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === "TOKEN_REFRESHED") { setSession(s); return; }
      // Defer: calling Supabase inside this callback can deadlock the auth lock.
      setTimeout(() => apply(s), 0);
    });
    return () => { mounted = false; sub.subscription.unsubscribe(); };
  }, []);

  const refreshProfile = async () => { if (session) setProfile(await loadProfile(session.user.id)); };
  return <Ctx.Provider value={{ ready, session, profile, refreshProfile }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);

export async function signIn(email: string, password: string): Promise<string | null> {
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error || !data.user) return "Email or password is not right.";
  const p = await loadProfile(data.user.id);
  if (!p || p.role !== "family") {
    await supabase.auth.signOut();
    return "This app is for family and friends. Facility staff should use the web console.";
  }
  if (p.status !== "active") {
    await supabase.auth.signOut();
    return "This account is not active. Please contact the facility.";
  }
  return null;
}
