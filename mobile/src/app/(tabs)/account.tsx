import { useCallback, useState } from "react";
import { Alert, AppState, Linking, ScrollView, Text, TextInput, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import Constants from "expo-constants";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { enablePush, notificationStatus, unregisterPush } from "@/lib/push";
import { supabase } from "@/lib/supabase";
import { keys, useBalance, useDeletion } from "@/lib/queries";
import { formatCents } from "@shared/payments";
import { Avatar, Badge, Button, Row, Section } from "@/components/ui";
import { colors, space, type } from "@/components/theme";

const APP_ENV = Constants.expoConfig?.extra?.appEnv as string | undefined;

function Icon({ name }: { name: keyof typeof Ionicons.glyphMap }) {
  return (
    <View style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: colors.primaryTint, alignItems: "center", justifyContent: "center" }}>
      <Ionicons name={name} size={18} color={colors.primary} />
    </View>
  );
}

// Account deletion (App Store guideline 5.1.1(v)). Deletion happens 30 days after the request; signing in and
// cancelling before then keeps the account. Re-entering the password guards against a borrowed phone.
function DeleteAccount({ email, balance }: { email?: string; balance?: number }) {
  const qc = useQueryClient();
  const deletion = useDeletion();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const refresh = () => qc.invalidateQueries({ queryKey: keys.deletion });
  const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: "long" });

  async function request() {
    setBusy(true);
    setError(undefined);
    const auth = await supabase.auth.signInWithPassword({ email: email ?? "", password });
    if (auth.error) { setError("That password isn't right."); setBusy(false); return; }
    const { error: e } = await supabase.rpc("request_account_deletion");
    setBusy(false);
    if (e) { setError("Couldn't start deletion. Please try again."); return; }
    setPassword("");
    setOpen(false);
    refresh();
  }
  async function cancel() {
    setBusy(true);
    const { error: e } = await supabase.rpc("cancel_account_deletion");
    setBusy(false);
    if (e) { Alert.alert("Couldn't cancel", "Please try again."); return; }
    refresh();
  }

  if (deletion.data) {
    return (
      <Section title="Delete account" footer="Until then you can keep using Kinline. After that your name, email, phone and ID photo are erased and you can't sign in. Messages and visits stay in the facility's records as “Deleted user”.">
        <Row title={`Deletion scheduled for ${day(deletion.data)}`} left={<Icon name="trash-outline" />} />
        <View style={{ padding: space(4) }}>
          <Button title="Keep my account" variant="secondary" busy={busy} busyTitle="Cancelling…" onPress={cancel} />
        </View>
      </Section>
    );
  }
  return (
    <Section title="Delete account">
      <Row title="Delete my account" left={<Icon name="trash-outline" />} chevron onPress={() => setOpen((o) => !o)} accessibilityLabel="Delete my account" />
      {open && (
        <View style={{ padding: space(4), gap: space(3) }}>
          <Text style={[type.footnote, { color: colors.muted }]}>
            Your account is deleted 30 days after you confirm, and you can cancel any time before then. Your name, email, phone and ID photo are erased, and you won&apos;t be able to sign in.
            Messages and visits stay in the facility&apos;s records as “Deleted user”.
            {balance && balance > 0 ? ` Your remaining balance of ${formatCents(balance)} will be forfeited and cannot be refunded.` : ""}
          </Text>
          <TextInput
            value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoComplete="current-password"
            placeholder="Enter your password to confirm" accessibilityLabel="Password"
            style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: space(3), fontSize: 16 }}
          />
          {error && <Text style={[type.footnote, { color: colors.danger }]} accessibilityRole="alert">{error}</Text>}
          <Button title="Delete my account" variant="danger" busy={busy} busyTitle="Working…" disabled={!password} onPress={request} />
        </View>
      )}
    </Section>
  );
}

export default function Account() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [push, setPush] = useState<string>();
  const [busy, setBusy] = useState(false);
  const balance = useBalance();

  // Re-read permission when the tab gains focus or the app returns from Settings.
  useFocusEffect(useCallback(() => {
    notificationStatus().then(setPush);
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") notificationStatus().then(setPush); });
    return () => sub.remove();
  }, []));

  function confirmSignOut() {
    Alert.alert("Sign out?", "You'll stop getting notifications on this device until you sign in again.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out", style: "destructive",
        onPress: async () => {
          setBusy(true);
          await unregisterPush().catch(() => {});
          qc.clear();
          await supabase.auth.signOut();
        },
      },
    ]);
  }

  const pushLabel = push === "granted" ? "On" : push === "denied" ? "Off" : "Not set up";
  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: space(4), gap: space(6) }}>
      <Section title="Account">
        <Row
          title={profile?.full_name ?? ""}
          subtitle={profile?.email}
          left={<Avatar name={profile?.full_name ?? ""} size={48} />}
          accessibilityLabel={`Signed in as ${profile?.full_name}, ${profile?.email}`}
        />
        <Row divider title="Website access" subtitle="Use the same email and password on the Kinline website." left={<Icon name="globe-outline" />} />
      </Section>

      <Section title="Balance">
        <Row
          title="Balance and history"
          left={<Icon name="wallet-outline" />}
          right={balance.data !== undefined ? <Text style={[type.subhead, { color: colors.muted }]}>{formatCents(balance.data)}</Text> : undefined}
          accessibilityLabel={`Balance${balance.data !== undefined ? ` ${formatCents(balance.data)}` : ""}`}
          onPress={() => router.push("/wallet")}
        />
      </Section>

      <Section
        title="Preferences"
        footer="Notifications tell you when a message arrives or a visit or connection is decided. They never show what a message says."
      >
        <Row
          title="Notifications"
          left={<Icon name="notifications-outline" />}
          right={<Badge tone={push === "granted" ? "green" : "slate"}>{pushLabel}</Badge>}
          chevron={push !== "granted"}
          accessibilityLabel={`Notifications: ${pushLabel}`}
          onPress={push === "granted" ? undefined
            : push === "denied" ? () => Linking.openSettings()
            : async () => { await enablePush(true); setPush(await notificationStatus()); }}
        />
        {push === "denied" && (
          <View style={{ paddingHorizontal: space(4), paddingBottom: space(3) }}>
            <Text style={[type.footnote, { color: colors.faint }]}>Turn notifications on in Settings to hear about new messages and visits.</Text>
          </View>
        )}
      </Section>

      <Section title="About">
        <Row title="Monitoring" subtitle="Messages are reviewed by facility staff before delivery. Video visits may be watched by staff and can be ended by them." left={<Icon name="shield-checkmark-outline" />} />
        <Row divider title="Visit time limits" subtitle="Each video visit ends automatically at its scheduled end time." left={<Icon name="time-outline" />} />
        <Row divider title="Version" left={<Icon name="information-circle-outline" />}
          right={<Text style={[type.subhead, { color: colors.faint }]}>{Constants.expoConfig?.version}{APP_ENV && APP_ENV !== "production" ? ` (${APP_ENV})` : ""}</Text>} />
      </Section>

      <DeleteAccount email={profile?.email} balance={balance.data} />

      <Button title="Sign out" variant="secondary" busy={busy} busyTitle="Signing out…" onPress={confirmSignOut} />
    </ScrollView>
  );
}
