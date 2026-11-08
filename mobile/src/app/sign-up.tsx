import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { apiPost, ApiError } from "@/lib/api";
import { signIn } from "@/lib/auth";
import { DEFAULT_FACILITY } from "@/lib/env";
import { Button, Card, ErrorText, Field, Muted } from "@/components/ui";
import { space } from "@/components/theme";

// Uses the same /api/family/signup route as the website, so accounts are created identically
// (role and facility set server-side in app_metadata; public Auth sign-up stays disabled).
export default function SignUp() {
  const [form, setForm] = useState({ fullName: "", email: "", phone: "", password: "" });
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit() {
    setError(undefined);
    if (form.password.length < 8) return setError("Password must be at least 8 characters.");
    setBusy(true);
    try {
      await apiPost("/api/family/signup", { ...form, facility: DEFAULT_FACILITY });
      const err = await signIn(form.email, form.password);
      if (err) setError(err);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not create account.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: space(4), gap: space(4) }} keyboardShouldPersistTaps="handled">
        <Card style={{ gap: space(4) }}>
          <Muted>Create a free account to message and video-visit someone at the facility.</Muted>
          <Field label="Full name" value={form.fullName} onChangeText={set("fullName")} autoComplete="name" textContentType="name" />
          <Field label="Email" value={form.email} onChangeText={set("email")} autoCapitalize="none" keyboardType="email-address" autoComplete="email" textContentType="emailAddress" />
          <Field label="Phone" value={form.phone} onChangeText={set("phone")} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" />
          <Field label="Password" hint="At least 8 characters" value={form.password} onChangeText={set("password")} secureTextEntry autoComplete="new-password" textContentType="newPassword" />
          <ErrorText>{error}</ErrorText>
          <Button title="Create account" busy={busy} busyTitle="Creating…" onPress={submit}
            disabled={!form.fullName || !form.email || !form.phone || !form.password} />
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
