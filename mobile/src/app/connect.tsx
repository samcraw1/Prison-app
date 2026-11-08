import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { keys } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import { pickPhoto, uploadPhoto, type PickedPhoto } from "@/lib/upload";
import { Button, Card, ErrorText, Field, Muted } from "@/components/ui";
import { space } from "@/components/theme";

export default function Connect() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [form, setForm] = useState({ residentName: "", booking: "", relationship: "" });
  const [photo, setPhoto] = useState<PickedPhoto>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function choose(src: "camera" | "library") {
    const r = await pickPhoto(src);
    if (r && "error" in r) setError(r.error);
    else if (r) { setError(undefined); setPhoto(r); }
  }

  async function submit() {
    setError(undefined);
    if (!/^[A-Za-z0-9-]{3,20}$/.test(form.booking.trim())) return setError("Booking number can only use letters, numbers and dashes.");
    if (!photo) return setError("Please add a photo of your government ID.");
    if (!profile) return;
    setBusy(true);
    try {
      const path = await uploadPhoto("id-photos", photo, profile.facility_id, profile.id);
      const { error: rpcError } = await supabase.rpc("request_connection", {
        p_resident_name: form.residentName.trim(),
        p_booking: form.booking.trim(),
        p_relationship: form.relationship.trim(),
        p_id_photo_path: path,
      });
      if (rpcError) throw new Error("Could not send your request. Check the details and try again.");
      await qc.invalidateQueries({ queryKey: keys.requests });
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send your request.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: space(4), gap: space(4) }} keyboardShouldPersistTaps="handled">
        <Muted>Facility staff review every request. Your ID photo is only seen by staff and is stored securely.</Muted>
        <Card style={{ gap: space(4) }}>
          <Field label="Resident's full name" value={form.residentName} onChangeText={set("residentName")} autoCapitalize="words" maxLength={100} />
          <Field label="Booking number" value={form.booking} onChangeText={set("booking")} autoCapitalize="characters" autoCorrect={false} maxLength={20} />
          <Field label="Your relationship" hint="For example: Mother, Friend" value={form.relationship} onChangeText={set("relationship")} maxLength={40} />
          <Muted>Photo of your government ID</Muted>
          {photo ? <Image source={{ uri: photo.uri }} style={{ width: "100%", height: 180, borderRadius: 12 }} contentFit="cover" accessibilityLabel="ID photo preview" /> : null}
          <View style={{ flexDirection: "row", gap: space(2) }}>
            <Button title="Take photo" variant="secondary" style={{ flex: 1 }} onPress={() => choose("camera")} />
            <Button title="Choose photo" variant="secondary" style={{ flex: 1 }} onPress={() => choose("library")} />
          </View>
          <ErrorText>{error}</ErrorText>
          <Button title="Send request" busy={busy} busyTitle="Sending…" onPress={submit}
            disabled={form.residentName.trim().length < 2 || !form.booking || form.relationship.trim().length < 2} />
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
