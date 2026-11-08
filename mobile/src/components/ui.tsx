import { forwardRef, type ComponentRef, type ReactNode } from "react";
import {
  ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View,
  type PressableProps, type StyleProp, type TextInputProps, type ViewStyle,
} from "react-native";
import * as Haptics from "expo-haptics";
import type { Tone } from "@shared/status";
import { colors, radius, space } from "./theme";

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={s.title} accessibilityRole="header">{children}</Text>;
}

export function Muted({ children, style }: { children: ReactNode; style?: object }) {
  return <Text style={[s.muted, style]}>{children}</Text>;
}

type ButtonProps = Omit<PressableProps, "children"> & { title: string; variant?: "primary" | "secondary" | "danger"; busy?: boolean; busyTitle?: string };
export function Button({ title, variant = "primary", busy, busyTitle, disabled, onPress, style, ...rest }: ButtonProps) {
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      disabled={off}
      onPress={(e) => { Haptics.selectionAsync().catch(() => {}); onPress?.(e); }}
      style={(state) => [
        s.btn,
        variant === "primary" ? s.btnPrimary : variant === "danger" ? s.btnDanger : s.btnSecondary,
        state.pressed && { opacity: 0.85 },
        off && { opacity: 0.5 },
        typeof style === "function" ? style(state) : style,
      ]}
      {...rest}
    >
      {busy && <ActivityIndicator color={variant === "secondary" ? colors.primary : "#fff"} style={{ marginRight: 8 }} />}
      <Text style={[s.btnText, variant === "secondary" && { color: colors.text }]}>{busy && busyTitle ? busyTitle : title}</Text>
    </Pressable>
  );
}

export const Field = forwardRef<ComponentRef<typeof TextInput>, TextInputProps & { label: string; hint?: string }>(function Field({ label, hint, style, ...rest }, ref) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput ref={ref} accessibilityLabel={label} placeholderTextColor={colors.faint} style={[s.input, style]} {...rest} />
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  );
});

export function ErrorText({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={s.error}>{children}</Text>;
}

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  const c = colors[tone];
  return (
    <View style={[s.badge, { backgroundColor: c.bg }]}>
      <Text style={[s.badgeText, { color: c.fg }]}>{children}</Text>
    </View>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <View style={s.center} accessibilityLabel={label}>
      <ActivityIndicator color={colors.primary} size="large" />
    </View>
  );
}

export function Empty({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <View style={[s.center, { paddingVertical: space(12), gap: space(2) }]}>
      <Text style={s.emptyTitle}>{title}</Text>
      {body ? <Text style={[s.muted, { textAlign: "center" }]}>{body}</Text> : null}
      {action}
    </View>
  );
}

export function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <Empty
      title="Couldn't load this"
      body="Check your connection and try again."
      action={<Button title="Try again" variant="secondary" onPress={onRetry} style={{ marginTop: space(2) }} />}
    />
  );
}

export const s = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, padding: space(4) },
  title: { fontSize: 20, fontWeight: "700", color: colors.text },
  muted: { fontSize: 15, color: colors.muted, lineHeight: 21 },
  label: { fontSize: 15, fontWeight: "600", color: colors.text },
  hint: { fontSize: 13, color: colors.faint },
  input: { minHeight: 48, borderWidth: 1, borderColor: "#cbd5e1", borderRadius: radius.md, paddingHorizontal: space(3), fontSize: 17, color: colors.text, backgroundColor: "#fff" },
  btn: { minHeight: 48, borderRadius: radius.md, paddingHorizontal: space(5), alignItems: "center", justifyContent: "center", flexDirection: "row" },
  btnPrimary: { backgroundColor: colors.primary },
  btnSecondary: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#cbd5e1" },
  btnDanger: { backgroundColor: colors.danger },
  btnText: { color: "#fff", fontSize: 17, fontWeight: "600" },
  error: { backgroundColor: colors.dangerSoft, color: colors.danger, padding: space(3), borderRadius: radius.sm, fontSize: 15 },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, alignSelf: "flex-start" },
  badgeText: { fontSize: 13, fontWeight: "600" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: space(6) },
  emptyTitle: { fontSize: 17, fontWeight: "600", color: colors.text, textAlign: "center" },
});
