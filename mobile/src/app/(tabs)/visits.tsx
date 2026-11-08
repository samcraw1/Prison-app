import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, RefreshControl, SectionList, Text, View } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQueryClient } from "@tanstack/react-query";
import { canCancel, EARLY_JOIN_MS, isJoinable, minutesBetween, VISIT_PHASE, visitPhase, type VisitPhase } from "@shared/status";
import { keys, useContacts, useVisits, type Visit } from "@/lib/queries";
import { useLiveQuery } from "@/lib/realtime";
import { syncVisitReminders } from "@/lib/push";
import { supabase } from "@/lib/supabase";
import { Avatar, Badge, Button, Card, EmptyRow, LoadError, Loading } from "@/components/ui";
import { colors, space, type } from "@/components/theme";

const day = (iso: string) => new Date(iso).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

type Item = { v: Visit; phase: VisitPhase; joinable: boolean };

function hint(item: Item, now: number): string | null {
  const { v, phase } = item;
  if (phase === "upcoming") {
    const opensIn = new Date(v.visit_slots.starts_at).getTime() - EARLY_JOIN_MS - now;
    if (opensIn < 24 * 3600_000) return `You can join from ${time(new Date(new Date(v.visit_slots.starts_at).getTime() - EARLY_JOIN_MS).toISOString())}.`;
    return "You can join 5 minutes before it starts.";
  }
  if (phase === "pending") return "Facility staff will review this request.";
  if (phase === "missed") return "Nobody joined during the scheduled time.";
  if (phase === "not_reviewed") return "Staff didn't review this request before the start time.";
  return null;
}

function VisitCard({ item, name, now, onCancel }: { item: Item; name: string; now: number; onCancel: (id: string) => void }) {
  const { v, phase, joinable } = item;
  const meta = VISIT_PHASE[phase];
  const note = hint(item, now);
  return (
    <Card style={{ gap: space(3), opacity: meta.past ? 0.92 : 1 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space(3) }}>
        <Avatar name={name} size={44} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[type.headline, { color: colors.text }]} numberOfLines={2}>{name}</Text>
          <Text style={[type.subhead, { color: colors.muted }]}>{day(v.visit_slots.starts_at)}</Text>
        </View>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space(2) }}>
        <Badge tone={meta.tone}>{meta.label}</Badge>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Ionicons name="time-outline" size={16} color={colors.faint} />
          <Text style={[type.subhead, { color: colors.muted }]}>
            {time(v.visit_slots.starts_at)} – {time(v.visit_slots.ends_at)} · {minutesBetween(v.visit_slots.starts_at, v.visit_slots.ends_at)} min
          </Text>
        </View>
      </View>
      {v.deny_reason ? <Text style={[type.subhead, { color: colors.muted }]}>Reason: {v.deny_reason}</Text> : null}
      {note ? <Text style={[type.footnote, { color: colors.faint }]}>{note}</Text> : null}
      {joinable && (
        <Button title={phase === "live" ? "Rejoin visit" : "Join visit"} onPress={() => router.push({ pathname: "/visit/[id]", params: { id: v.id } })}
          accessibilityLabel={`Join video visit with ${name}`} />
      )}
      {canCancel(v.status, joinable) && !meta.past && (
        <Button title="Cancel visit" variant="secondary" onPress={() => onCancel(v.id)} accessibilityLabel={`Cancel video visit with ${name}`} />
      )}
    </Card>
  );
}

export default function Visits() {
  const qc = useQueryClient();
  const visits = useVisits();
  const contacts = useContacts();
  useLiveQuery("visits", [keys.visits]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(id); }, []);
  useEffect(() => { if (visits.data) syncVisitReminders(visits.data).catch(() => {}); }, [visits.data]);

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => { setRefreshing(true); await visits.refetch(); setRefreshing(false); }, [visits]);

  const sections = useMemo(() => {
    const items: Item[] = (visits.data ?? []).map((v) => ({
      v,
      phase: visitPhase({ status: v.status, end_reason: v.end_reason, starts_at: v.visit_slots.starts_at, ends_at: v.visit_slots.ends_at }, now),
      // Same rule the join route enforces; the server re-checks (including suspensions) when you tap Join.
      joinable: isJoinable(v.status, v.visit_slots.starts_at, v.visit_slots.ends_at, now),
    }));
    const upcoming = items.filter((i) => !VISIT_PHASE[i.phase].past).sort((a, b) => a.v.visit_slots.starts_at.localeCompare(b.v.visit_slots.starts_at));
    const past = items.filter((i) => VISIT_PHASE[i.phase].past).sort((a, b) => b.v.visit_slots.starts_at.localeCompare(a.v.visit_slots.starts_at));
    return [
      ...(upcoming.length ? [{ title: "Upcoming", data: upcoming }] : []),
      ...(past.length ? [{ title: "Past", data: past }] : []),
    ];
  }, [visits.data, now]);

  if (visits.isPending) return <Loading />;
  if (visits.isError) return <LoadError onRetry={() => visits.refetch()} />;
  const nameOf = (id: string) => contacts.data?.find((c) => c.contact_id === id)?.name ?? "Resident";
  const hasContacts = (contacts.data?.length ?? 0) > 0;

  function cancel(id: string) {
    Alert.alert("Cancel this visit?", "You can request another time later.", [
      { text: "Keep visit", style: "cancel" },
      {
        text: "Cancel visit", style: "destructive",
        onPress: async () => {
          const { error } = await supabase.rpc("cancel_visit", { p_visit: id });
          if (error) Alert.alert("Could not cancel", "Please try again.");
          qc.invalidateQueries({ queryKey: keys.visits });
        },
      },
    ]);
  }

  return (
    <SectionList
      sections={sections}
      keyExtractor={(i) => i.v.id}
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: space(4), gap: space(3) }}
      stickySectionHeadersEnabled={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      ListHeaderComponent={
        <View style={{ gap: space(2), marginBottom: space(2) }}>
          <Button title="Request a video visit" onPress={() => router.push("/request-visit")} disabled={!hasContacts}
            accessibilityHint={hasContacts ? undefined : "You need an approved connection first"} />
          {!hasContacts && <Text style={[type.footnote, { color: colors.faint, textAlign: "center" }]}>You need an approved connection before you can request a visit.</Text>}
        </View>
      }
      renderSectionHeader={({ section }) => (
        <Text style={[type.sectionHeader, { color: colors.faint, paddingHorizontal: space(4), marginTop: space(3) }]} accessibilityRole="header">{section.title}</Text>
      )}
      renderItem={({ item }) => <VisitCard item={item} name={nameOf(item.v.contact_id)} now={now} onCancel={cancel} />}
      ListEmptyComponent={
        <Card>
          <EmptyRow icon="videocam-outline" title="No visits yet"
            body={hasContacts ? "Request a time and facility staff will review it. Approved visits show up here." : "Once a connection is approved, you can request video visits here."} />
        </Card>
      }
      ListFooterComponent={<Text style={[type.footnote, { color: colors.faint, textAlign: "center", marginTop: space(4) }]}>Video visits may be monitored by facility staff.</Text>}
    />
  );
}
