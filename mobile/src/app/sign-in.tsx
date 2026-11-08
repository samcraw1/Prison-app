import { useRef, useState, type ComponentRef } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View, type TextInput } from "react-native";
import { Image } from "expo-image";
import { Link } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { signIn } from "@/lib/auth";
import { Button, Card, ErrorText, Field, Muted } from "@/components/ui";
import { colors, space } from "@/components/theme";

export default function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const pwRef = useRef<ComponentRef<typeof TextInput>>(null);

  async function submit() {
    if (!email || !password || busy) return;
    setBusy(true);
    setError(undefined);
    const err = await signIn(email, password);
    setBusy(false);
    if (err) setError(err);
    // On success the auth provider swaps to the signed-in stack.
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: space(5), gap: space(6) }} keyboardShouldPersistTaps="handled">
          <View style={{ alignItems: "center", gap: space(2) }}>
            <Image source={require("../../assets/icon.png")} style={{ width: 72, height: 72, borderRadius: 16 }} accessibilityIgnoresInvertColors />
            <Text style={{ fontSize: 28, fontWeight: "700", color: colors.primaryDark }} accessibilityRole="header">SecureVisit</Text>
            <Muted style={{ textAlign: "center" }}>Stay connected with the people you love.</Muted>
          </View>
          <Card style={{ gap: space(4) }}>
            <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address"
              textContentType="username" returnKeyType="next" onSubmitEditing={() => pwRef.current?.focus()} />
            <Field ref={pwRef} label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password"
              textContentType="password" returnKeyType="go" onSubmitEditing={submit} />
            <ErrorText>{error}</ErrorText>
            <Button title="Sign in" busy={busy} busyTitle="Signing in…" disabled={!email || !password} onPress={submit} />
          </Card>
          <Text style={{ textAlign: "center", color: colors.muted, fontSize: 15 }}>
            New here?{" "}
            <Link href="/sign-up" style={{ color: colors.primary, fontWeight: "600" }}>Create an account</Link>
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
