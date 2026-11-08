import { forwardRef, type ComponentRef, type ReactNode } from "react";
import {
  ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View,
  type PressableProps, type StyleProp, type TextInputProps, type ViewStyle,
} from "react-native";
import * as Haptics from "expo-haptics";
import type { Tone } from "@shared/status";
import { colors, MIN_TOUCH, radius, space, type } from "./theme";
import Ionicons from "@expo/vector-icons/Ionicons";

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={s.title} accessibilityRole="header">{children}</Text>;
}

export function Muted({ children, style }: { children: ReactNode; style?: object }) {
  return <Text style={[s.muted, style]}>{children}</Text>;
}

type ButtonProps = Omit<PressableProps, "children"> & { title: string; variant?: "primary" | "secondary" | "danger"; size?: "regular" | "small"; busy?: boolean; busyTitle?: string };
export function Button({ title, variant = "primary", size = "regular", busy, busyTitle, disabled, onPress, style, ...rest }: ButtonProps) {
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      disabled={off}
      onPress={(e) => { Haptics.selectionAsync().catch(() => {}); onPress?.(e); }}
      style={(state) => [
        s.btn,
        size === "small" && s.btnSmall,
        variant === "primary" ? s.btnPrimary : variant === "danger" ? s.btnDanger : s.btnSecondary,
        state.pressed && { opacity: 0.85 },
        off && { opacity: 0.5 },
        typeof style === "function" ? style(state) : style,
      ]}
      {...rest}
    >
      {busy && <ActivityIndicator color={variant === "secondary" ? colors.primary : "#fff"} style={{ marginRight: 8 }} />}
      <Text style={[s.btnText, size === "small" && { fontSize: 15 }, variant === "secondary" && { color: colors.primary }]}>{busy && busyTitle ? busyTitle : title}</Text>
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

/** iOS-style grouped section: small uppercase header above a rounded card. */
export function Section({ title, action, children, footer }: { title?: string; action?: ReactNode; children: ReactNode; footer?: string }) {
  return (
    <View style={{ gap: space(2) }}>
      {(title || action) && (
        <View style={s.sectionHead}>
          {title ? <Text style={s.sectionTitle} accessibilityRole="header">{title}</Text> : <View />}
          {action}
        </View>
      )}
      <View style={s.group}>{children}</View>
      {footer ? <Text style={s.sectionFooter}>{footer}</Text> : null}
    </View>
  );
}

/** A tappable (or static) row inside a Section. Separators are drawn by `divider`. */
export function Row({
  title, subtitle, left, right, onPress, divider, accessibilityLabel, destructive, chevron = !!onPress,
}: {
  title: string; subtitle?: ReactNode; left?: ReactNode; right?: ReactNode; onPress?: () => void;
  divider?: boolean; accessibilityLabel?: string; destructive?: boolean; chevron?: boolean;
}) {
  const body = (
    <View style={[s.row, divider && s.rowDivider]}>
      {left}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[s.rowTitle, destructive && { color: colors.danger }]}>{title}</Text>
        {typeof subtitle === "string" ? <Text style={s.rowSubtitle}>{subtitle}</Text> : subtitle}
      </View>
      {right}
      {chevron ? <Ionicons name="chevron-forward" size={18} color="#94a3b8" /> : null}
    </View>
  );
  if (!onPress) return <View accessible accessibilityLabel={accessibilityLabel}>{body}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }}
      style={({ pressed }) => pressed && { backgroundColor: "#f1f5f9" }}
    >
      {body}
    </Pressable>
  );
}

export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
  return (
    <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: colors.primaryDark, fontWeight: "700", fontSize: size * 0.38 }} maxFontSizeMultiplier={1.2}>{initials || "?"}</Text>
    </View>
  );
}

/** Compact, dismissible inline notice (used for the notification prompt). */
export function Notice({ icon, title, body, action, onDismiss }: { icon: keyof typeof Ionicons.glyphMap; title: string; body?: string; action?: ReactNode; onDismiss?: () => void }) {
  return (
    <View style={s.notice}>
      <Ionicons name={icon} size={22} color={colors.primary} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type.subhead, { fontWeight: "600", color: colors.primaryDark }]}>{title}</Text>
        {body ? <Text style={[type.footnote, { color: colors.muted }]}>{body}</Text> : null}
        {action ? <View style={{ flexDirection: "row", marginTop: space(2) }}>{action}</View> : null}
      </View>
      {onDismiss ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" onPress={onDismiss} hitSlop={10}
          style={{ width: MIN_TOUCH, height: MIN_TOUCH, alignItems: "center", justifyContent: "center", marginTop: -10, marginRight: -10 }}>
          <Ionicons name="close" size={20} color={colors.faint} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** Empty state inside a Section. */
export function EmptyRow({ icon, title, body, action }: { icon: keyof typeof Ionicons.glyphMap; title: string; body?: string; action?: ReactNode }) {
  return (
    <View style={{ alignItems: "center", paddingVertical: space(6), paddingHorizontal: space(5), gap: space(2) }}>
      <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: colors.primaryTint, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name={icon} size={26} color={colors.primary} />
      </View>
      <Text style={[type.headline, { color: colors.text, textAlign: "center" }]}>{title}</Text>
      {body ? <Text style={[type.subhead, { color: colors.muted, textAlign: "center", lineHeight: 21 }]}>{body}</Text> : null}
      {action ? <View style={{ marginTop: space(2), alignSelf: "stretch" }}>{action}</View> : null}
    </View>
  );
}

export const s = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: space(4) },
  title: { fontSize: 20, fontWeight: "700", color: colors.text },
  muted: { fontSize: 15, color: colors.muted, lineHeight: 21 },
  label: { fontSize: 15, fontWeight: "600", color: colors.text },
  hint: { fontSize: 13, color: colors.faint },
  input: { minHeight: 48, borderWidth: 1, borderColor: "#cbd5e1", borderRadius: radius.md, paddingHorizontal: space(3), fontSize: 17, color: colors.text, backgroundColor: "#fff" },
  btnSmall: { minHeight: MIN_TOUCH - 8, paddingHorizontal: space(4), borderRadius: radius.pill },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space(4) },
  sectionTitle: { ...type.sectionHeader, color: colors.faint },
  sectionFooter: { ...type.footnote, color: colors.faint, paddingHorizontal: space(4), lineHeight: 18 },
  group: { backgroundColor: colors.card, borderRadius: radius.lg, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: space(3), minHeight: 56, paddingHorizontal: space(4), paddingVertical: space(3) },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  rowTitle: { ...type.body, color: colors.text },
  rowSubtitle: { ...type.subhead, color: colors.faint },
  notice: { flexDirection: "row", gap: space(3), alignItems: "flex-start", backgroundColor: colors.primaryTint, borderRadius: radius.lg, padding: space(4), borderWidth: 1, borderColor: colors.primarySoft },
  btn: { minHeight: 48, borderRadius: radius.md, paddingHorizontal: space(5), alignItems: "center", justifyContent: "center", flexDirection: "row" },
  btnPrimary: { backgroundColor: colors.primary },
  btnSecondary: { backgroundColor: colors.primaryTint, borderWidth: 1, borderColor: colors.primarySoft },
  btnDanger: { backgroundColor: colors.danger },
  btnText: { color: "#fff", fontSize: 17, fontWeight: "600" },
  error: { backgroundColor: colors.dangerSoft, color: colors.danger, padding: space(3), borderRadius: radius.sm, fontSize: 15 },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, alignSelf: "flex-start" },
  badgeText: { fontSize: 13, fontWeight: "600" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: space(6) },
  emptyTitle: { fontSize: 17, fontWeight: "600", color: colors.text, textAlign: "center" },
});
