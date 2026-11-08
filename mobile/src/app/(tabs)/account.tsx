import { useCallback, useState } from "react";
import { Alert, AppState, Linking, ScrollView, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import Constants from "expo-constants";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { enablePush, notificationStatus, unregisterPush } from "@/lib/push";
import { supabase } from "@/lib/supabase";
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

export default function Account() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [push, setPush] = useState<string>();
  const [busy, setBusy] = useState(false);

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

      <Button title="Sign out" variant="secondary" busy={busy} busyTitle="Signing out…" onPress={confirmSignOut} />
    </ScrollView>
  );
}
