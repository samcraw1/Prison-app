// Native setup for @daily-co/react-native-daily-js.
// Daily's own config plugin (@daily-co/config-plugin-rn-daily-js) only declares support for Expo SDK 55–57,
// so the one thing it adds that app config cannot express — the Android foreground service that keeps an
// ongoing call alive — is declared here. Camera/mic permissions and iOS background modes are in app.config.ts.
const { withAndroidManifest, AndroidConfig } = require("expo/config-plugins");

const SERVICE = "com.daily.reactlibrary.DailyOngoingMeetingForegroundService";

module.exports = function withDailyNative(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    app.service = (app.service ?? []).filter((s) => s.$["android:name"] !== SERVICE);
    app.service.push({
      $: {
        "android:name": SERVICE,
        "android:exported": "false",
        "android:foregroundServiceType": "camera|microphone",
      },
    });
    return cfg;
  });
};
