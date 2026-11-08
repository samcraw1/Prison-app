import { useCallback, useState } from "react";
import { AppState, RefreshControl, ScrollView, Text, View } from "react-native";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { DEPOSIT_AMOUNTS_CENTS, formatCents, ledgerDescription } from "@shared/payments";
import { keys, useBalance, useLedger } from "@/lib/queries";
import { useLiveQuery } from "@/lib/realtime";
import { openCheckout, purchaseMode } from "@/lib/payments";
import { ApiError } from "@/lib/api";
import { Button, EmptyRow, ErrorText, LoadError, Loading, Notice, Row, Section } from "@/components/ui";
import { colors, space, type } from "@/components/theme";

const when = (iso: string) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function Wallet() {
  // kinline://wallet?status=success|cancelled when returning from Stripe Checkout.
  const { status } = useLocalSearchParams<{ status?: string }>();
  const qc = useQueryClient();
  const balance = useBalance();
  const ledger = useLedger();
  // The webhook writes the ledger; realtime (RLS-filtered to this user) refreshes the screen when it lands.
  useLiveQuery("ledger_entries", [keys.balance, keys.ledger]);
  const [busy, setBusy] = useState<number>();
  const [error, setError] = useState<string>();
  const mode = purchaseMode();

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: keys.balance });
    qc.invalidateQueries({ queryKey: keys.ledger });
  }, [qc]);

  // Coming back from the browser: re-read the balance (realtime may have been paused in the background).
  useFocusEffect(useCallback(() => {
    refresh();
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") refresh(); });
    return () => sub.remove();
  }, [refresh]));

  async function add(amount: number) {
    setBusy(amount);
    setError(undefined);
    try {
      await openCheckout(amount);
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : "Could not open checkout. Please try again.");
    } finally {
      setBusy(undefined);
    }
  }

  if (balance.isPending) return <Loading />;
  if (balance.isError) return <LoadError onRetry={refresh} />;
  const cents = balance.data;

  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: space(4), gap: space(6) }}
      refreshControl={<RefreshControl refreshing={balance.isRefetching || ledger.isRefetching} onRefresh={refresh} />}
    >
      {status === "success" && (
        <Notice icon="checkmark-circle-outline" title="Thanks" body="Your payment is being confirmed. Your balance updates in a moment." />
      )}
      {status === "cancelled" && <Notice icon="close-circle-outline" title="Payment cancelled" body="You were not charged." />}

      <View accessible accessibilityLabel={`Balance ${formatCents(cents)}`} style={{ alignItems: "center", gap: space(1), paddingVertical: space(4) }}>
        <Text style={[type.footnote, { color: colors.muted }]}>Your balance</Text>
        <Text style={{ fontSize: 44, fontWeight: "700", color: cents < 0 ? colors.danger : colors.text }}>{formatCents(cents)}</Text>
      </View>

      {mode === "external_link" ? (
        <Section title="Add funds" footer="Opens a secure Stripe page in your browser. Kinline never sees your card number.">
          <View style={{ padding: space(4), gap: space(3) }}>
            {DEPOSIT_AMOUNTS_CENTS.map((a) => (
              <Button key={a} title={`Add ${formatCents(a)}`} variant="secondary" busy={busy === a} busyTitle="Opening…"
                disabled={busy !== undefined} onPress={() => add(a)} />
            ))}
            <ErrorText>{error}</ErrorText>
          </View>
        </Section>
      ) : (
        <Section title="Add funds">
          <View style={{ padding: space(4) }}>
            <Text style={[type.subhead, { color: colors.muted, lineHeight: 21 }]}>
              You can add funds on the Kinline website, signed in with this account. Your balance here updates automatically.
            </Text>
          </View>
        </Section>
      )}

      <Section title="History" footer="Facilities set their own prices. Fees for messages that aren't delivered and visits that don't take place are refunded here.">
        {ledger.isPending ? <Loading /> : ledger.isError ? <LoadError onRetry={() => ledger.refetch()} /> : ledger.data.length === 0 ? (
          <EmptyRow icon="wallet-outline" title="No activity yet" />
        ) : (
          ledger.data.map((e, i) => (
            <Row key={e.id} divider={i > 0} title={ledgerDescription(e)} subtitle={when(e.created_at)}
              accessibilityLabel={`${ledgerDescription(e)}, ${e.amount_cents > 0 ? "plus" : "minus"} ${formatCents(Math.abs(e.amount_cents))}, ${when(e.created_at)}`}
              right={<Text style={[type.subhead, { fontWeight: "600", color: e.amount_cents > 0 ? colors.green.fg : colors.text }]}>
                {e.amount_cents > 0 ? "+" : ""}{formatCents(e.amount_cents)}
              </Text>} />
          ))
        )}
      </Section>
    </ScrollView>
  );
}
