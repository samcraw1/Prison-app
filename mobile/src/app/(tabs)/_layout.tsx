import { Tabs } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { colors } from "@/components/theme";

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: colors.primary, headerTitleStyle: { color: colors.text }, sceneStyle: { backgroundColor: colors.bg } }}>
      <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: ({ color, size }) => <Ionicons name="chatbubbles" color={color as string} size={size} /> }} />
      <Tabs.Screen name="visits" options={{ title: "Video visits", tabBarLabel: "Visits", tabBarIcon: ({ color, size }) => <Ionicons name="videocam" color={color as string} size={size} /> }} />
      <Tabs.Screen name="account" options={{ title: "Account", tabBarIcon: ({ color, size }) => <Ionicons name="person-circle" color={color as string} size={size} /> }} />
    </Tabs>
  );
}
