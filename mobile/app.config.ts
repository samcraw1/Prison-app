import type { ExpoConfig } from "expo/config";

// Per-environment values come from EAS build profiles (eas.json) or .env.local for local runs.
// Only public values belong here: the Supabase URL + anon key (RLS protects the data) and the web API origin.
const APP_ENV = process.env.APP_ENV ?? "development";
const suffix = APP_ENV === "production" ? "" : `.${APP_ENV}`;

const config: ExpoConfig = {
  name: APP_ENV === "production" ? "SecureVisit" : `SecureVisit (${APP_ENV})`,
  slug: "securevisit",
  scheme: "securevisit",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "light",
  ios: {
    bundleIdentifier: (process.env.IOS_BUNDLE_ID ?? "com.securevisit.mobile") + suffix,
    supportsTablet: false,
    infoPlist: {
      NSCameraUsageDescription: "SecureVisit uses your camera for video visits and to photograph your ID for connection requests.",
      NSMicrophoneUsageDescription: "SecureVisit uses your microphone so you can talk during video visits.",
      NSPhotoLibraryUsageDescription: "SecureVisit lets you choose photos to send in messages and an ID photo for connection requests.",
      UIBackgroundModes: ["voip", "audio", "remote-notification"],
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: (process.env.ANDROID_PACKAGE ?? "com.securevisit.mobile") + suffix,
    adaptiveIcon: {
      backgroundColor: "#FFFFFF",
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundImage: "./assets/android-icon-background.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
    permissions: [
      "android.permission.CAMERA",
      "android.permission.RECORD_AUDIO",
      "android.permission.MODIFY_AUDIO_SETTINGS",
      "android.permission.ACCESS_NETWORK_STATE",
      "android.permission.WAKE_LOCK",
      "android.permission.FOREGROUND_SERVICE",
      "android.permission.FOREGROUND_SERVICE_CAMERA",
      "android.permission.FOREGROUND_SERVICE_MICROPHONE",
      "android.permission.POST_NOTIFICATIONS",
    ],
    blockedPermissions: ["android.permission.READ_EXTERNAL_STORAGE", "android.permission.WRITE_EXTERNAL_STORAGE"],
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON,
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    ["expo-notifications", { color: "#1e40af" }],
    [
      "expo-image-picker",
      {
        photosPermission: "SecureVisit lets you choose photos to send in messages and an ID photo for connection requests.",
        cameraPermission: "SecureVisit uses your camera to photograph your ID for connection requests.",
        microphonePermission: false,
      },
    ],
    ["expo-build-properties", { android: { minSdkVersion: 24 } }],
    // Daily's plugin adds the native WebRTC setup, permissions and the Android ongoing-call foreground service.
    ["@daily-co/config-plugin-rn-daily-js", { enableCamera: true, enableMicrophone: true, enableScreenShare: false }],
  ],
  experiments: { typedRoutes: true },
  extra: {
    appEnv: APP_ENV,
    eas: { projectId: process.env.EAS_PROJECT_ID },
  },
};

export default config;
