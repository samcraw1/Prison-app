import { useEffect, useState } from "react";
import { Linking, ScrollView, Text } from "react-native";
import Constants from "expo-constants";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { enablePush, notificationStatus, unregisterPush } from "@/lib/push";
import { supabase } from "@/lib/supabase";
import { Button, Card, Muted, Title } from "@/components/ui";
import { colors, space } from "@/components/theme";

export default function Account() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [push, setPush] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => { notificationStatus().then(setPush); }, []);

  async function signOut() {
    setBusy(true);
    await unregisterPush().catch(() => {});
    qc.clear();
    await supabase.auth.signOut();
  }

  return (
    <ScrollView contentContainerStyle={{ padding: space(4), gap: space(4) }}>
      <Card style={{ gap: space(1) }}>
        <Title>{profile?.full_name}</Title>
        <Muted>{profile?.email}</Muted>
      </Card>
      <Card style={{ gap: space(3) }}>
        <Text style={{ fontSize: 17, fontWeight: "600", color: colors.text }}>Notifications</Text>
        <Muted>
          {push === "granted" ? "On. You'll be told about new messages and visit updates. Message text is never shown in notifications."
            : push === "denied" ? "Off. Turn them on in Settings to hear about new messages and visits."
            : "Get told when new messages arrive and when visits are approved."}
        </Muted>
        {push === "denied" ? (
          <Button title="Open Settings" variant="secondary" onPress={() => Linking.openSettings()} />
        ) : push !== "granted" ? (
          <Button title="Turn on notifications" variant="secondary" onPress={async () => { await enablePush(true); setPush(await notificationStatus()); }} />
        ) : null}
      </Card>
      <Card style={{ gap: space(2) }}>
        <Muted>Messages and video visits are reviewed and may be monitored by facility staff.</Muted>
        <Muted>Your account works on the website too, with the same email and password.</Muted>
      </Card>
      <Button title="Sign out" variant="secondary" busy={busy} onPress={signOut} />
      <Text style={{ textAlign: "center", color: colors.faint, fontSize: 12 }}>
        Version {Constants.expoConfig?.version} · {Constants.expoConfig?.extra?.appEnv}
      </Text>
    </ScrollView>
  );
}
