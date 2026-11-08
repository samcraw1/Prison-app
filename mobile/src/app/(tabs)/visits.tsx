import { useCallback, useEffect, useState } from "react";
import { Alert, FlatList, RefreshControl, Text, View } from "react-native";
import { router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { canCancel, isJoinable, VISIT_LABEL, VISIT_TONE } from "@shared/status";
import { keys, useContacts, useVisits } from "@/lib/queries";
import { useLiveQuery } from "@/lib/realtime";
import { syncVisitReminders } from "@/lib/push";
import { supabase } from "@/lib/supabase";
import { Badge, Button, Card, Empty, LoadError, Loading, Muted } from "@/components/ui";
import { colors, space } from "@/components/theme";

const fmt = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

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

  if (visits.isPending) return <Loading />;
  if (visits.isError) return <LoadError onRetry={() => visits.refetch()} />;
  const nameOf = (id: string) => contacts.data?.find((c) => c.contact_id === id)?.name ?? "Resident";

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
    <FlatList
      data={visits.data}
      keyExtractor={(v) => v.id}
      contentContainerStyle={{ padding: space(4), gap: space(3) }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      ListHeaderComponent={<Button title="Request a video visit" onPress={() => router.push("/request-visit")} style={{ marginBottom: space(1) }} />}
      ListEmptyComponent={<Empty title="No visits yet" body="Request a time and facility staff will review it." />}
      renderItem={({ item: v }) => {
        const joinable = isJoinable(v.status, v.visit_slots.starts_at, v.visit_slots.ends_at, now);
        return (
          <Card style={{ gap: space(2) }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: space(2) }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 17, fontWeight: "600", color: colors.text }}>{nameOf(v.contact_id)}</Text>
                <Muted>{fmt(v.visit_slots.starts_at)}</Muted>
              </View>
              <Badge tone={VISIT_TONE[v.status]}>{VISIT_LABEL[v.status]}</Badge>
            </View>
            {v.deny_reason ? <Muted>Reason: {v.deny_reason}</Muted> : null}
            {joinable && <Button title="Join visit" onPress={() => router.push({ pathname: "/visit/[id]", params: { id: v.id } })} />}
            {canCancel(v.status, joinable) && <Button title="Cancel" variant="secondary" onPress={() => cancel(v.id)} />}
          </Card>
        );
      }}
    />
  );
}
