import { useCallback, useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { keys, useContacts, useRequests } from "@/lib/queries";
import { useLiveQuery } from "@/lib/realtime";
import { enablePush, notificationStatus } from "@/lib/push";
import { Badge, Button, Card, Empty, LoadError, Loading, Muted, Title } from "@/components/ui";
import { colors, space } from "@/components/theme";

export default function Home() {
  const contacts = useContacts();
  const requests = useRequests();
  useLiveQuery("connection_requests", [keys.requests, keys.contacts]);
  useLiveQuery("contacts", [keys.contacts]);

  const [askPush, setAskPush] = useState(false);
  useEffect(() => { notificationStatus().then((s) => setAskPush(s === "undetermined")); }, []);

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([contacts.refetch(), requests.refetch()]);
    setRefreshing(false);
  }, [contacts, requests]);

  if (contacts.isPending) return <Loading />;
  if (contacts.isError) return <LoadError onRetry={() => contacts.refetch()} />;
  const open = (requests.data ?? []).filter((r) => r.status !== "approved");

  return (
    <ScrollView contentContainerStyle={{ padding: space(4), gap: space(4) }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      {askPush && (
        <Card style={{ gap: space(3), backgroundColor: colors.primarySoft, borderColor: colors.primarySoft }}>
          <Text style={{ fontSize: 16, fontWeight: "600", color: colors.primaryDark }}>Get notified about new messages and visits</Text>
          <Muted>Notifications never show message text.</Muted>
          <View style={{ flexDirection: "row", gap: space(2) }}>
            <Button title="Turn on" onPress={async () => { await enablePush(true); setAskPush(false); }} />
            <Button title="Not now" variant="secondary" onPress={() => setAskPush(false)} />
          </View>
        </Card>
      )}

      <Card style={{ gap: space(2) }}>
        <Title>Your connections</Title>
        {contacts.data.length ? (
          contacts.data.map((c) => (
            <Pressable
              key={c.contact_id}
              accessibilityRole="button"
              accessibilityLabel={`Messages with ${c.name}`}
              onPress={() => router.push({ pathname: "/thread/[contactId]", params: { contactId: c.contact_id, name: c.name } })}
              style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", minHeight: 56, gap: space(3), opacity: pressed ? 0.6 : 1 })}
            >
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ color: colors.primaryDark, fontWeight: "700", fontSize: 16 }}>{c.name.charAt(0)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 17, fontWeight: "600", color: colors.text }}>{c.name}</Text>
                <Text style={{ fontSize: 14, color: colors.faint }}>{c.relationship}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.faint} />
            </Pressable>
          ))
        ) : (
          <Empty title="No approved connections yet" body="Request one to get started." />
        )}
        <Button title="Connect with someone" variant={contacts.data.length ? "secondary" : "primary"} onPress={() => router.push("/connect")} />
      </Card>

      {open.length > 0 && (
        <Card style={{ gap: space(3) }}>
          <Title>Requests</Title>
          {open.map((r) => (
            <View key={r.id} style={{ gap: 4 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
                <Text style={{ fontSize: 16, color: colors.text, flex: 1 }}>{r.typed_resident_name} <Text style={{ color: colors.faint }}>({r.relationship})</Text></Text>
                <Badge tone={r.status === "pending" ? "amber" : "red"}>{r.status === "pending" ? "Waiting for staff" : "Not approved"}</Badge>
              </View>
              {r.deny_reason ? <Muted>Reason: {r.deny_reason}</Muted> : null}
            </View>
          ))}
        </Card>
      )}
    </ScrollView>
  );
}
