import { useMemo, useRef, useState } from "react";
import { FlatList, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { fetch as expoFetch } from "expo/fetch";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { API_URL } from "@/lib/env";
import { supabase } from "@/lib/supabase";
import { ErrorText } from "@/components/ui";
import { colors, radius, space, type } from "@/components/theme";
import { HELP_DISCLAIMER, helpErrorText } from "@shared/help/errors";

const SUGGESTIONS = ["Why is my message held?", "How do video visits work?", "How do I connect with someone?"];

// AI help assistant. The server (/api/help/chat) answers only from the platform FAQ and the facility's published
// rules and FAQ; it never sees this person's messages, visits or account. Nothing typed here is stored.
export default function Help() {
  const insets = useSafeAreaInsets();
  const headerHeight = Platform.OS === "ios" ? insets.top + 44 : 0;
  const [input, setInput] = useState("");
  const [reported, setReported] = useState<Set<string>>(new Set());
  const list = useRef<FlatList<UIMessage>>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `${API_URL}/api/help/chat`,
        fetch: expoFetch as unknown as typeof globalThis.fetch,
        headers: async (): Promise<Record<string, string>> => {
          const { data } = await supabase.auth.getSession();
          const token = data.session?.access_token;
          return token ? { authorization: `Bearer ${token}` } : {};
        },
      }),
    [],
  );
  const { messages, sendMessage, status, error, clearError } = useChat({ transport });
  const busy = status === "submitted" || status === "streaming";

  function ask(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    clearError();
    void sendMessage({ text: q.slice(0, 1000) });
    setInput("");
  }

  async function report(id: string) {
    setReported((s) => new Set(s).add(id));
    await supabase.rpc("report_help_answer");
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={headerHeight}>
      <FlatList
        ref={list}
        data={messages}
        keyExtractor={(m) => m.id}
        onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })}
        contentContainerStyle={{ padding: space(4), gap: space(3) }}
        keyboardDismissMode="interactive"
        ListHeaderComponent={
          <View style={{ gap: space(3) }}>
            <Text style={[type.footnote, { color: colors.muted, backgroundColor: colors.slate.bg, padding: space(3), borderRadius: radius.md }]}>
              {HELP_DISCLAIMER}
            </Text>
            {messages.length === 0 && (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
                {SUGGESTIONS.map((s) => (
                  <Pressable key={s} accessibilityRole="button" onPress={() => ask(s)}
                    style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: space(3), borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card }}>
                    <Text style={[type.subhead, { color: colors.primary }]}>{s}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        }
        ListFooterComponent={status === "submitted" ? <Text style={[type.subhead, { color: colors.faint }]}>Thinking…</Text> : null}
        renderItem={({ item }) => {
          const mine = item.role === "user";
          const text = item.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
          return (
            <View style={{ alignItems: mine ? "flex-end" : "flex-start" }}>
              <View style={{
                maxWidth: "85%", borderRadius: radius.xl, paddingHorizontal: space(4), paddingVertical: space(3),
                backgroundColor: mine ? colors.primary : colors.card, borderWidth: mine ? 0 : 1, borderColor: colors.border,
              }}>
                <Text selectable style={{ fontSize: 17, lineHeight: 23, color: mine ? "#fff" : colors.text }}>{text}</Text>
                {!mine && text && !busy ? (
                  reported.has(item.id) ? (
                    <Text style={{ fontSize: 12, marginTop: 4, color: colors.faint }}>Thanks, reported.</Text>
                  ) : (
                    <Pressable accessibilityRole="button" hitSlop={12} onPress={() => report(item.id)}>
                      <Text style={{ fontSize: 12, marginTop: 4, color: colors.faint, textDecorationLine: "underline" }}>Report answer</Text>
                    </Pressable>
                  )
                ) : null}
              </View>
            </View>
          );
        }}
      />
      <View style={{ borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: space(3), paddingBottom: Math.max(insets.bottom, space(3)), gap: space(2) }}>
        <ErrorText>{helpErrorText(error) ?? undefined}</ErrorText>
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: space(2) }}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Ask a question"
            placeholderTextColor={colors.faint}
            accessibilityLabel="Your question"
            multiline
            maxLength={1000}
            style={{ flex: 1, minHeight: 44, maxHeight: 140, borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 22, paddingHorizontal: space(4), paddingTop: 11, paddingBottom: 11, fontSize: 17, color: colors.text }}
          />
          <Pressable accessibilityRole="button" accessibilityLabel="Ask" accessibilityState={{ disabled: busy || !input.trim() }} disabled={busy || !input.trim()} onPress={() => ask(input)}
            style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", opacity: busy || !input.trim() ? 0.4 : 1 }}>
            <Ionicons name="arrow-up" size={22} color="#fff" />
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
