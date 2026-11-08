import { useEffect, useState } from "react";
import { ActionSheetIOS, Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from "react-native";
import { Image } from "expo-image";
import { Stack, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import { useQueryClient } from "@tanstack/react-query";
import { MAX_MESSAGE_CHARS, messageStatusNote } from "@shared/status";
import { friendlyError, keys, useContacts, useThread, type Message } from "@/lib/queries";
import { useLiveQuery } from "@/lib/realtime";
import { useAuth } from "@/lib/auth";
import { markThreadSeen } from "@/lib/unread";
import { supabase } from "@/lib/supabase";
import { pickPhoto, uploadPhoto, type PickedPhoto } from "@/lib/upload";
import { Empty, ErrorText, LoadError, Loading } from "@/components/ui";
import { colors, radius, space } from "@/components/theme";

type Pending = { id: string; body: string; photoUri?: string };
const time = (iso: string) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function Thread() {
  const { contactId, name } = useLocalSearchParams<{ contactId: string; name?: string }>();
  const { profile } = useAuth();
  const qc = useQueryClient();
  const contacts = useContacts();
  const thread = useThread(contactId);
  useLiveQuery("messages", [keys.thread(contactId)], `contact_id=eq.${contactId}`);
  const insets = useSafeAreaInsets();
  const headerHeight = Platform.OS === "ios" ? insets.top + 44 : 0;

  const [body, setBody] = useState("");
  const [photo, setPhoto] = useState<PickedPhoto>();
  const [pending, setPending] = useState<Pending[]>([]);
  const [error, setError] = useState<string>();

  // Opening the thread marks its delivered messages as seen on this device (drives the Home "New message" dot).
  useEffect(() => {
    if (profile && thread.data) markThreadSeen(profile.id, contactId).catch(() => {});
  }, [profile, contactId, thread.data]);

  const contactName = name ?? contacts.data?.find((c) => c.contact_id === contactId)?.name ?? "Messages";
  const notFound = contacts.isSuccess && !contacts.data.some((c) => c.contact_id === contactId);

  async function choosePhoto() {
    const go = async (src: "library" | "camera") => {
      const r = await pickPhoto(src);
      if (r && "error" in r) setError(r.error);
      else if (r) { setError(undefined); setPhoto(r); }
    };
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions({ options: ["Cancel", "Take photo", "Choose from library"], cancelButtonIndex: 0 }, (i) => {
        if (i === 1) go("camera"); else if (i === 2) go("library");
      });
    } else {
      Alert.alert("Add a photo", undefined, [
        { text: "Take photo", onPress: () => go("camera") },
        { text: "Choose from library", onPress: () => go("library") },
        { text: "Cancel", style: "cancel" },
      ]);
    }
  }

  async function send() {
    const text = body.trim();
    if (!text || !profile) return;
    const local: Pending = { id: `local-${Date.now()}`, body: text, photoUri: photo?.uri };
    const sendingPhoto = photo;
    setPending((p) => [local, ...p]);
    setBody("");
    setPhoto(undefined);
    setError(undefined);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      const path = sendingPhoto ? await uploadPhoto("message-attachments", sendingPhoto, profile.facility_id, profile.id) : null;
      const { error: rpcError } = await supabase.rpc("send_message", { p_contact: contactId, p_body: text, p_attachment_path: path });
      if (rpcError) throw rpcError;
      await qc.invalidateQueries({ queryKey: keys.thread(contactId) });
    } catch (e) {
      setBody(text);
      setPhoto(sendingPhoto);
      setError(e instanceof Error && e.message.includes("photo") ? e.message : friendlyError(e as { code?: string; message?: string }, "Could not send. Please try again."));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } finally {
      setPending((p) => p.filter((x) => x.id !== local.id));
    }
  }

  if (notFound) return <Empty title="This conversation isn't available" body="The connection may have been removed by the facility." />;

  const items: (Message | (Pending & { pending: true }))[] = [...pending.map((p) => ({ ...p, pending: true as const })), ...(thread.data ?? [])];

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={headerHeight}>
      <Stack.Screen options={{ title: contactName }} />
      {thread.isPending ? <Loading /> : thread.isError ? <LoadError onRetry={() => thread.refetch()} /> : (
        <FlatList
          inverted
          data={items}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: space(4), gap: space(3), flexGrow: items.length ? undefined : 1 }}
          keyboardDismissMode="interactive"
          ListEmptyComponent={<View style={{ transform: [{ scaleY: -1 }], flex: 1 }}><Empty title="No messages yet" body="Say hello. Messages are reviewed by facility staff." /></View>}
          renderItem={({ item }) => {
            const isPending = "pending" in item;
            const mine = isPending || item.sender === "family";
            const note = isPending ? "Sending…" : mine ? messageStatusNote(item.status) : null;
            const photoUri = isPending ? item.photoUri : item.photo;
            return (
              <View style={{ alignItems: mine ? "flex-end" : "flex-start" }}>
                <View
                  accessible
                  accessibilityLabel={`${mine ? "You" : contactName}: ${item.body}${note ? `. ${note}` : ""}`}
                  style={{
                    maxWidth: "85%", borderRadius: radius.xl, paddingHorizontal: space(4), paddingVertical: space(3),
                    backgroundColor: mine ? colors.primary : colors.card, borderWidth: mine ? 0 : 1, borderColor: colors.border,
                    opacity: isPending ? 0.7 : 1,
                  }}
                >
                  <Text selectable style={{ fontSize: 17, lineHeight: 23, color: mine ? "#fff" : colors.text }}>{item.body}</Text>
                  {photoUri ? <Image source={{ uri: photoUri }} style={{ width: 220, height: 220, borderRadius: radius.md, marginTop: space(2) }} contentFit="cover" accessibilityLabel="Attached photo" /> : null}
                  <Text style={{ fontSize: 12, marginTop: 4, color: mine ? "#bfdbfe" : colors.faint }}>
                    {isPending ? "" : time(item.created_at)}{note ? `${isPending ? "" : " · "}${note}` : ""}
                  </Text>
                </View>
              </View>
            );
          }}
        />
      )}
      <View style={{ borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: space(3), paddingBottom: Math.max(insets.bottom, space(3)), gap: space(2) }}>
        <ErrorText>{error}</ErrorText>
        {photo && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
            <Image source={{ uri: photo.uri }} style={{ width: 48, height: 48, borderRadius: 8 }} />
            <Text style={{ flex: 1, color: colors.muted }}>Photo attached</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Remove photo" onPress={() => setPhoto(undefined)} hitSlop={12}>
              <Ionicons name="close-circle" size={24} color={colors.faint} />
            </Pressable>
          </View>
        )}
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: space(2) }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Add photo" onPress={choosePhoto} hitSlop={8}
            style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="image-outline" size={26} color={colors.primary} />
          </Pressable>
          <TextInput
            value={body}
            onChangeText={setBody}
            placeholder="Write a message"
            placeholderTextColor={colors.faint}
            accessibilityLabel="Message"
            multiline
            maxLength={MAX_MESSAGE_CHARS}
            style={{ flex: 1, minHeight: 44, maxHeight: 140, borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 22, paddingHorizontal: space(4), paddingTop: 11, paddingBottom: 11, fontSize: 17, color: colors.text }}
          />
          <Pressable accessibilityRole="button" accessibilityLabel="Send" accessibilityState={{ disabled: !body.trim() }} disabled={!body.trim()} onPress={send}
            style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", opacity: body.trim() ? 1 : 0.4 }}>
            <Ionicons name="arrow-up" size={22} color="#fff" />
          </Pressable>
        </View>
        <Text style={{ fontSize: 12, color: colors.faint, textAlign: "center" }}>All messages are reviewed by facility staff.</Text>
      </View>
    </KeyboardAvoidingView>
  );
}
