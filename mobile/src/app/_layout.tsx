import { useEffect } from "react";
import { AppState, Platform } from "react-native";
import { Stack, router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as Notifications from "expo-notifications";
import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "@/lib/auth";
import { enablePush, routeForNotification } from "@/lib/push";
import { colors } from "@/components/theme";
import { Loading } from "@/components/ui";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, retry: 2 } },
});

// Refetch when the app returns to the foreground.
AppState.addEventListener("change", (s) => { if (Platform.OS !== "web") focusManager.setFocused(s === "active"); });

function RootStack() {
  const { ready, session } = useAuth();
  const signedIn = !!session;

  // Re-register this device's push token each launch (no prompt; only if already allowed).
  useEffect(() => { if (signedIn) enablePush(false).catch(() => {}); }, [signedIn]);

  // Open the right screen from a notification tap, including a cold start.
  const lastResponse = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (!signedIn || !lastResponse) return;
    const route = routeForNotification(lastResponse.notification.request.content.data as Record<string, unknown>);
    if (route) router.push(route as never);
    Notifications.clearLastNotificationResponse();
  }, [signedIn, lastResponse]);

  if (!ready) return <Loading />;
  return (
    <Stack screenOptions={{ headerTintColor: colors.primary, headerTitleStyle: { color: colors.text }, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        <Stack.Screen name="sign-up" options={{ title: "Create account" }} />
      </Stack.Protected>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="thread/[contactId]" options={{ title: "Messages" }} />
        <Stack.Screen name="connect" options={{ title: "Connect with someone", presentation: "modal" }} />
        <Stack.Screen name="request-visit" options={{ title: "Request a visit", presentation: "modal" }} />
        <Stack.Screen name="visit/[id]" options={{ headerShown: false, presentation: "fullScreenModal", gestureEnabled: false }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <StatusBar style="dark" />
          <RootStack />
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
