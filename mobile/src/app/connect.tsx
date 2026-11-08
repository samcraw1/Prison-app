import { useEffect, useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Image } from "expo-image";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { keys, useConnectFacilities } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import { pickPhoto, uploadPhoto, type PickedPhoto } from "@/lib/upload";
import { Button, ErrorText, Field, LoadError, Loading, Notice, Section } from "@/components/ui";
import { colors, MIN_TOUCH, radius, space, type } from "@/components/theme";

const BOOKING = /^[A-Za-z0-9-]{3,20}$/;
type Check = "idle" | "checking" | "matched" | "unmatched";

// Connect flow:
//  1. choose the facility, enter the resident's full name + booking number, and check them. The server answers only
//     matched / not matched (rate-limited); the app never receives roster data.
//  2. add relationship + government ID photo and send. Staff at that facility review every request; a match never
//     approves anything. If the details can't be confirmed, the family can still send it for staff to verify.
export default function Connect() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const facilities = useConnectFacilities();

  const [facilityId, setFacilityId] = useState<string>();
  const [filter, setFilter] = useState("");
  const [name, setName] = useState("");
  const [booking, setBooking] = useState("");
  const [check, setCheck] = useState<Check>("idle");
  const [proceedUnverified, setProceedUnverified] = useState(false);
  const [relationship, setRelationship] = useState("");
  const [photo, setPhoto] = useState<PickedPhoto>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  // Default to the account's home facility.
  useEffect(() => {
    if (!facilityId && facilities.data?.length) {
      setFacilityId(facilities.data.find((f) => f.id === profile?.facility_id)?.id ?? (facilities.data.length === 1 ? facilities.data[0].id : undefined));
    }
  }, [facilities.data, facilityId, profile?.facility_id]);

  // Any change to who/where invalidates a previous check.
  useEffect(() => { setCheck("idle"); setProceedUnverified(false); }, [facilityId, name, booking]);

  const facility = facilities.data?.find((f) => f.id === facilityId);
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (facilities.data ?? []).filter((f) => !q || f.name.toLowerCase().includes(q));
  }, [facilities.data, filter]);

  const detailsValid = !!facilityId && name.trim().length >= 2 && BOOKING.test(booking.trim());
  const step2 = check === "matched" || (check === "unmatched" && proceedUnverified);

  async function verify() {
    setError(undefined);
    if (!detailsValid) {
      return setError(!facilityId ? "Choose a facility." : name.trim().length < 2 ? "Enter the resident's full name." : "Booking numbers use letters, numbers and dashes (3–20 characters).");
    }
    setCheck("checking");
    const { data, error: rpcError } = await supabase.rpc("verify_resident", { p_facility: facilityId, p_resident_name: name.trim(), p_booking: booking.trim() });
    if (rpcError) {
      setCheck("idle");
      return setError(rpcError.code === "P0001" ? "Too many checks. Please wait an hour and try again, or contact the facility." : "Couldn't check right now. Please try again.");
    }
    setCheck(data ? "matched" : "unmatched");
    Haptics.notificationAsync(data ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning).catch(() => {});
  }

  async function choose(src: "camera" | "library") {
    const r = await pickPhoto(src);
    if (r && "error" in r) setError(r.error);
    else if (r) { setError(undefined); setPhoto(r); }
  }

  async function submit() {
    setError(undefined);
    if (relationship.trim().length < 2) return setError("Enter your relationship, for example Mother or Friend.");
    if (!photo) return setError("Add a photo of your government ID.");
    if (!profile || !facilityId) return;
    setBusy(true);
    try {
      // Stored privately under the reviewing facility; only you and that facility's staff can view it.
      const path = await uploadPhoto("id-photos", photo, facilityId, profile.id);
      const { error: rpcError } = await supabase.rpc("request_connection", {
        p_facility: facilityId,
        p_resident_name: name.trim(),
        p_booking: booking.trim(),
        p_relationship: relationship.trim(),
        p_id_photo_path: path,
      });
      if (rpcError) {
        throw new Error(rpcError.code === "P0001" ? "Too many requests. Please wait and try again, or contact the facility." : "Couldn't send your request. Check the details and try again.");
      }
      await qc.invalidateQueries({ queryKey: keys.requests });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send your request.");
    } finally {
      setBusy(false);
    }
  }

  if (facilities.isPending) return <Loading />;
  if (facilities.isError) return <LoadError onRetry={() => facilities.refetch()} />;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: space(4), gap: space(6), paddingBottom: space(10) }} keyboardShouldPersistTaps="handled">
        <Text style={[type.subhead, { color: colors.muted, lineHeight: 21 }]}>
          Facility staff review every request before you can message or visit.
        </Text>

        <Section title="1. Facility">
          {(facilities.data?.length ?? 0) > 6 && (
            <View style={{ padding: space(3), paddingBottom: 0 }}>
              <TextInput value={filter} onChangeText={setFilter} placeholder="Search facilities" placeholderTextColor={colors.faint}
                accessibilityLabel="Search facilities" style={{ minHeight: MIN_TOUCH, borderRadius: radius.md, backgroundColor: colors.bg, paddingHorizontal: space(3), fontSize: 17, color: colors.text }} />
            </View>
          )}
          {shown.map((f, i) => {
            const selected = f.id === facilityId;
            return (
              <Pressable key={f.id} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={f.name}
                onPress={() => setFacilityId(f.id)}
                style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: space(3), minHeight: 52, paddingHorizontal: space(4) },
                  i > 0 && { borderTopWidth: 0.5, borderTopColor: colors.separator }, pressed && { backgroundColor: "#f1f5f9" }]}>
                <Text style={[type.body, { flex: 1, color: colors.text }]}>{f.name}</Text>
                {selected && <Ionicons name="checkmark" size={22} color={colors.primary} />}
              </Pressable>
            );
          })}
          {shown.length === 0 && <Text style={[type.subhead, { color: colors.faint, padding: space(4) }]}>No facilities match "{filter}".</Text>}
        </Section>

        <Section title="2. Who are you connecting with?">
          <View style={{ padding: space(4), gap: space(4) }}>
            <Field label="Resident's full name" value={name} onChangeText={setName} autoCapitalize="words" autoCorrect={false} maxLength={100} textContentType="none" />
            <Field label="Booking number" hint="Letters, numbers and dashes, as the facility gave it to you." value={booking} onChangeText={setBooking}
              autoCapitalize="characters" autoCorrect={false} maxLength={20} />
            {check === "matched" ? (
              <View accessibilityRole="alert" style={{ flexDirection: "row", gap: space(2), alignItems: "center", backgroundColor: colors.green.bg, borderRadius: radius.md, padding: space(3) }}>
                <Ionicons name="checkmark-circle" size={22} color={colors.green.fg} />
                <Text style={[type.subhead, { flex: 1, color: colors.green.fg }]}>Details confirmed{facility ? ` at ${facility.name}` : ""}. Staff will still review your request.</Text>
              </View>
            ) : check === "unmatched" ? (
              <Notice
                icon="help-circle-outline"
                title="We couldn't confirm those details"
                body="Check the spelling of the full name and the booking number. If they're right, you can still send the request and facility staff will verify it."
                action={!proceedUnverified ? <Button title="Send for staff to verify" size="small" variant="secondary" onPress={() => setProceedUnverified(true)} /> : undefined}
              />
            ) : (
              <Button title="Check details" variant="secondary" busy={check === "checking"} busyTitle="Checking…" onPress={verify} disabled={!detailsValid} />
            )}
          </View>
        </Section>

        {step2 && (
          <Section title="3. About you" footer="Your ID photo is stored privately and only facility staff reviewing your request can see it.">
            <View style={{ padding: space(4), gap: space(4) }}>
              <Field label="Your relationship" hint="For example: Mother, Friend" value={relationship} onChangeText={setRelationship} maxLength={40} />
              <Text style={[type.headline, { color: colors.text }]}>Photo of your government ID</Text>
              {photo ? (
                <View style={{ gap: space(2) }}>
                  <Image source={{ uri: photo.uri }} style={{ width: "100%", aspectRatio: 1.6, borderRadius: radius.md }} contentFit="cover" accessibilityLabel="ID photo preview" />
                  <Button title="Replace photo" size="small" variant="secondary" onPress={() => choose("library")} />
                </View>
              ) : (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
                  <Button title="Take photo" variant="secondary" style={{ flexGrow: 1 }} onPress={() => choose("camera")} />
                  <Button title="Choose photo" variant="secondary" style={{ flexGrow: 1 }} onPress={() => choose("library")} />
                </View>
              )}
            </View>
          </Section>
        )}

        <ErrorText>{error}</ErrorText>
        {step2 && (
          <Button title="Send request" busy={busy} busyTitle="Sending…" onPress={submit} disabled={relationship.trim().length < 2 || !photo} />
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
