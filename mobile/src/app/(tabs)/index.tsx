import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { minutesBetween, VISIT_PHASE, visitPhase } from "@shared/status";
import { useAuth } from "@/lib/auth";
import { keys, useContacts, useLatestIncoming, useRequests, useVisits } from "@/lib/queries";
import { useLiveQuery } from "@/lib/realtime";
import { useSeen } from "@/lib/unread";
import { dismissPushPrompt, enablePush, notificationStatus, pushPromptDismissed } from "@/lib/push";
import { Avatar, Badge, Button, EmptyRow, LoadError, Loading, Notice, Row, Section } from "@/components/ui";
import { colors, space, type } from "@/components/theme";

const dayTime = (iso: string) =>
  new Date(iso).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function Home() {
  const { profile } = useAuth();
  const contacts = useContacts();
  const requests = useRequests();
  const visits = useVisits();
  const latest = useLatestIncoming();
  const isUnread = useSeen(profile?.id);
  useLiveQuery("connection_requests", [keys.requests, keys.contacts]);
  useLiveQuery("contacts", [keys.contacts]);
  useLiveQuery("messages", [keys.latestIncoming]);
  useLiveQuery("visits", [keys.visits]);

  const [askPush, setAskPush] = useState(false);
  useEffect(() => {
    Promise.all([notificationStatus(), pushPromptDismissed()]).then(([s, dismissed]) => setAskPush(s === "undetermined" && !dismissed));
  }, []);

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([contacts.refetch(), requests.refetch(), visits.refetch(), latest.refetch()]);
    setRefreshing(false);
  }, [contacts, requests, visits, latest]);

  const nameOf = useCallback((id: string) => contacts.data?.find((c) => c.contact_id === id)?.name ?? "Resident", [contacts.data]);
  const upcoming = useMemo(() => {
    const now = Date.now();
    return (visits.data ?? [])
      .map((v) => ({ v, phase: visitPhase({ status: v.status, end_reason: v.end_reason, starts_at: v.visit_slots.starts_at, ends_at: v.visit_slots.ends_at }, now) }))
      .filter((x) => !VISIT_PHASE[x.phase].past)
      .sort((a, b) => a.v.visit_slots.starts_at.localeCompare(b.v.visit_slots.starts_at))
      .slice(0, 2);
  }, [visits.data]);

  if (contacts.isPending) return <Loading />;
  if (contacts.isError) return <LoadError onRetry={() => contacts.refetch()} />;
  const openRequests = (requests.data ?? []).filter((r) => r.status !== "approved");
  const firstName = profile?.full_name.split(" ")[0];
  const unreadCount = contacts.data.filter((c) => isUnread(c.contact_id, latest.data?.[c.contact_id])).length;

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={{ padding: space(4), paddingTop: space(3), gap: space(6) }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={{ gap: space(1) }}>
          <Text style={[type.largeTitle, { color: colors.primaryDark }]} accessibilityRole="header">Stay connected.</Text>
          <Text style={[type.callout, { color: colors.muted }]}>
            {firstName ? `Hi ${firstName}. ` : ""}
            {unreadCount > 0 ? `You have new messages from ${unreadCount === 1 ? "1 person" : `${unreadCount} people`}.` : "Messages and visits with the people you love."}
          </Text>
        </View>

        {askPush && (
          <Notice
            icon="notifications-outline"
            title="Know when messages arrive"
            body="Notifications never show what a message says."
            action={<Button title="Turn on" size="small" onPress={async () => { await enablePush(true); setAskPush(false); }} />}
            onDismiss={() => { setAskPush(false); dismissPushPrompt(); }}
          />
        )}

        {upcoming.length > 0 && (
          <Section title="Upcoming visits" action={<Button title="See all" size="small" variant="secondary" onPress={() => router.navigate("/visits")} />}>
            {upcoming.map(({ v, phase }, i) => {
              const meta = VISIT_PHASE[phase];
              return (
                <Row
                  key={v.id}
                  divider={i > 0}
                  title={nameOf(v.contact_id)}
                  subtitle={`${dayTime(v.visit_slots.starts_at)} · ${minutesBetween(v.visit_slots.starts_at, v.visit_slots.ends_at)} min`}
                  left={<Avatar name={nameOf(v.contact_id)} />}
                  right={<Badge tone={meta.tone}>{meta.label}</Badge>}
                  accessibilityLabel={`Video visit with ${nameOf(v.contact_id)}, ${dayTime(v.visit_slots.starts_at)}, ${meta.label}`}
                  onPress={() => (phase === "ready" || phase === "live")
                    ? router.push({ pathname: "/visit/[id]", params: { id: v.id } })
                    : router.navigate("/visits")}
                />
              );
            })}
          </Section>
        )}

        <Section
          title="Connections"
          action={contacts.data.length ? <Button title="Add" size="small" variant="secondary" onPress={() => router.push("/connect")} accessibilityLabel="Connect with someone" /> : undefined}
        >
          {contacts.data.length ? (
            contacts.data.map((c, i) => {
              const unread = isUnread(c.contact_id, latest.data?.[c.contact_id]);
              return (
                <Row
                  key={c.contact_id}
                  divider={i > 0}
                  title={c.name}
                  subtitle={unread
                    ? <Text style={[type.subhead, { color: colors.primary, fontWeight: "600" }]}>New message</Text>
                    : `Connected as ${c.relationship}`}
                  left={<Avatar name={c.name} />}
                  right={unread ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary }} /> : undefined}
                  accessibilityLabel={`Messages with ${c.name}${unread ? ", new message" : ""}`}
                  onPress={() => router.push({ pathname: "/thread/[contactId]", params: { contactId: c.contact_id, name: c.name } })}
                />
              );
            })
          ) : (
            <EmptyRow
              icon="people-outline"
              title="Connect with someone"
              body="Send a request with the person's name and booking number. Facility staff review every request."
              action={<Button title="Connect with someone" onPress={() => router.push("/connect")} />}
            />
          )}
        </Section>

        {openRequests.length > 0 && (
          <Section title="Requests" footer="You'll get a notification when staff decide, if notifications are on.">
            {openRequests.map((r, i) => (
              <Row
                key={r.id}
                divider={i > 0}
                title={r.typed_resident_name}
                subtitle={r.deny_reason ? `${r.relationship} · Reason: ${r.deny_reason}` : r.relationship}
                right={<Badge tone={r.status === "pending" ? "amber" : "red"}>{r.status === "pending" ? "Waiting for staff" : "Not approved"}</Badge>}
              />
            ))}
          </Section>
        )}

        <Text style={[type.footnote, { color: colors.faint, textAlign: "center", paddingHorizontal: space(4) }]}>
          Messages and visits are reviewed and may be monitored by facility staff.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
