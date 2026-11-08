import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQueryClient } from "@tanstack/react-query";
import { keys, useContactPrices, useContacts, useSlots } from "@/lib/queries";
import { formatCents, isInsufficientBalance } from "@shared/payments";
import { supabase } from "@/lib/supabase";
import { Button, Card, Empty, ErrorText, LoadError, Loading, Muted } from "@/components/ui";
import { colors, space } from "@/components/theme";

function Choice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ selected }} onPress={onPress}
      style={{ flexDirection: "row", alignItems: "center", minHeight: 48, gap: space(3), paddingVertical: space(2) }}>
      <Ionicons name={selected ? "radio-button-on" : "radio-button-off"} size={22} color={selected ? colors.primary : colors.faint} />
      <Text style={{ fontSize: 16, color: colors.text, flex: 1 }}>{label}</Text>
    </Pressable>
  );
}

export default function RequestVisit() {
  const qc = useQueryClient();
  const contacts = useContacts();
  const [contactId, setContactId] = useState<string>();
  const who = contactId ?? contacts.data?.[0]?.contact_id;
  const slots = useSlots(who);
  const prices = useContactPrices(who);
  const [needsFunds, setNeedsFunds] = useState(false);
  const [slotId, setSlotId] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  if (contacts.isPending || (who && slots.isPending)) return <Loading />;
  if (contacts.isError || slots.isError) return <LoadError onRetry={() => { contacts.refetch(); slots.refetch(); }} />;
  if (!contacts.data.length) return <Empty title="No approved connections" body="You need an approved connection before you can request a visit." />;
  const slotList = slots.data ?? [];
  const when = slotId && slotList.some((s) => s.slot_id === slotId) ? slotId : slotList[0]?.slot_id;

  async function submit() {
    setBusy(true);
    setError(undefined);
    if (!who || !when) return;
    const { error: rpcError } = await supabase.rpc("request_visit", { p_contact: who, p_slot: when });
    setBusy(false);
    setNeedsFunds(isInsufficientBalance(rpcError));
    if (rpcError) return setError(isInsufficientBalance(rpcError) ? "Your balance is too low to request this visit." : rpcError.code === "P0001" ? rpcError.message : "Could not request that visit.");
    qc.invalidateQueries({ queryKey: ["wallet"] });
    await qc.invalidateQueries({ queryKey: keys.visits });
    await qc.invalidateQueries({ queryKey: keys.slots });
    router.back();
  }

  return (
    <ScrollView contentContainerStyle={{ padding: space(4), gap: space(4) }}>
      {contacts.data.length > 1 && (
        <Card>
          <Text style={{ fontSize: 17, fontWeight: "600", color: colors.text }}>Who are you visiting?</Text>
          {contacts.data.map((c) => <Choice key={c.contact_id} label={c.name} selected={who === c.contact_id} onPress={() => { setContactId(c.contact_id); setSlotId(undefined); }} />)}
        </Card>
      )}
      <Card>
        <Text style={{ fontSize: 17, fontWeight: "600", color: colors.text }}>Pick a time</Text>
        {slotList.length === 0 && <Muted style={{ marginTop: space(2) }}>No visit times are open at this facility right now. Please check back later.</Muted>}
        {slotList.map((s) => {
          const mins = Math.round((new Date(s.ends_at).getTime() - new Date(s.starts_at).getTime()) / 60000);
          const label = `${new Date(s.starts_at).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} (${mins} min)`;
          return <Choice key={s.slot_id} label={label} selected={when === s.slot_id} onPress={() => setSlotId(s.slot_id)} />;
        })}
      </Card>
      <View style={{ gap: space(2) }}>
        <ErrorText>{error}</ErrorText>
        {needsFunds && <Button title="View balance" variant="secondary" onPress={() => router.push("/wallet")} />}
        {prices.data?.visit_fee_cents ? (
          <Muted style={{ textAlign: "center" }}>
            This visit costs {formatCents(prices.data.visit_fee_cents)}, refunded if it isn&apos;t approved or doesn&apos;t take place.
          </Muted>
        ) : null}
        <Button title="Request visit" busy={busy} busyTitle="Sending…" onPress={submit} disabled={!when} />
        <Muted style={{ textAlign: "center" }}>Facility staff approve each visit. Visits may be monitored.</Muted>
      </View>
    </ScrollView>
  );
}
