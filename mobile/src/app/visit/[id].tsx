import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useKeepAwake } from "expo-keep-awake";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import { useQueryClient } from "@tanstack/react-query";
import Daily, { DailyMediaView, type DailyCall, type DailyParticipant } from "@daily-co/react-native-daily-js";
import { apiPost, ApiError } from "@/lib/api";
import { keys } from "@/lib/queries";
import { Button } from "@/components/ui";
import { colors, space } from "@/components/theme";

type JoinInfo = { url: string; token: string; endsAt: string; observer: boolean };
type Phase = "joining" | "waiting" | "connected" | "ended";

const END_MESSAGES: Record<string, string> = {
  ejected: "This visit was ended by facility staff.",
  "exp-token": "Time is up. This visit has ended.",
  "exp-room": "Time is up. This visit has ended.",
  "no-room": "This visit has ended.",
};

const track = (p: DailyParticipant | undefined, kind: "video" | "audio") => {
  const t = p?.tracks?.[kind];
  return t && t.state === "playable" ? (t.persistentTrack ?? t.track ?? null) : null;
};

export default function VisitCall() {
  useKeepAwake();
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const call = useRef<DailyCall | null>(null);
  const [phase, setPhase] = useState<Phase>("joining");
  const [error, setError] = useState<string>();
  const [endedNote, setEndedNote] = useState<string>();
  const [info, setInfo] = useState<JoinInfo>();
  const [local, setLocal] = useState<DailyParticipant>();
  const [remote, setRemote] = useState<DailyParticipant>();
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [remaining, setRemaining] = useState<number>();

  useEffect(() => {
    let cancelled = false;
    const co = Daily.createCallObject({ subscribeToTracksAutomatically: true });
    call.current = co;

    const refresh = () => {
      const ps = co.participants();
      setLocal(ps.local);
      // Staff observers join with hasPresence:false and never appear here.
      const others = Object.values(ps).filter((p) => !p.local);
      setRemote(others[0]);
      setPhase((ph) => (ph === "ended" ? ph : others.length ? "connected" : "waiting"));
    };
    const finish = (note?: string) => {
      if (cancelled) return;
      setEndedNote((n) => n ?? note ?? "This visit has ended.");
      setPhase("ended");
      qc.invalidateQueries({ queryKey: keys.visits });
    };

    co.on("joined-meeting", refresh)
      .on("participant-joined", refresh)
      .on("participant-updated", refresh)
      .on("participant-left", refresh)
      .on("track-started", refresh)
      .on("track-stopped", refresh)
      .on("left-meeting", () => finish())
      .on("error", (e) => finish(END_MESSAGES[e?.error?.type ?? ""] ?? "The call was disconnected."))
      .on("camera-error", () => setError("ClearLine can't use your camera or microphone. Allow access in Settings to see and hear each other."));

    (async () => {
      try {
        const j = await apiPost<JoinInfo>(`/api/visits/${id}/join`);
        if (cancelled) return;
        setInfo(j);
        await co.join({ url: j.url, token: j.token });
        if (!cancelled) refresh();
      } catch (e) {
        if (!cancelled) setError(e instanceof ApiError ? e.message : "Could not start the video call.");
      }
    })();

    return () => {
      cancelled = true;
      co.leave().catch(() => {}).finally(() => co.destroy().catch(() => {}));
      call.current = null;
    };
  }, [id, qc]);

  // Countdown to the end of the slot. The server-issued token also expires then and Daily removes the
  // participant, so the limit holds even if this timer is tampered with.
  useEffect(() => {
    if (!info) return;
    const tick = () => {
      const left = Math.max(0, Math.floor((new Date(info.endsAt).getTime() - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) call.current?.leave().catch(() => {});
      if (left === 60) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [info]);

  const close = () => router.back();
  const toggleMic = () => { call.current?.setLocalAudio(!micOn); setMicOn(!micOn); };
  const toggleCam = () => { call.current?.setLocalVideo(!camOn); setCamOn(!camOn); };
  const flip = () => { call.current?.cycleCamera().catch(() => {}); };

  if (error && phase !== "connected" && phase !== "waiting") {
    return (
      <SafeAreaView style={[st.fill, st.center, { padding: space(6), gap: space(4), backgroundColor: colors.bg }]}>
        <Ionicons name="videocam-off" size={48} color={colors.faint} />
        <Text accessibilityRole="alert" style={{ fontSize: 18, color: colors.text, textAlign: "center" }}>{error}</Text>
        <Button title="Go back" variant="secondary" onPress={close} />
      </SafeAreaView>
    );
  }
  if (phase === "ended") {
    return (
      <SafeAreaView style={[st.fill, st.center, { padding: space(6), gap: space(4), backgroundColor: colors.bg }]}>
        <Ionicons name="checkmark-circle" size={48} color={colors.primary} />
        <Text accessibilityRole="alert" style={{ fontSize: 18, color: colors.text, textAlign: "center" }}>{endedNote}</Text>
        <Button title="Done" onPress={close} />
      </SafeAreaView>
    );
  }

  const mm = remaining === undefined ? "" : `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;
  const remoteVideo = track(remote, "video");
  return (
    <View style={[st.fill, { backgroundColor: "#0b1220" }]}>
      {remoteVideo ? (
        <DailyMediaView videoTrack={remoteVideo} audioTrack={track(remote, "audio")} objectFit="cover" zOrder={0} style={st.fill} />
      ) : (
        <View style={[st.fill, st.center]}>
          {remote && <DailyMediaView videoTrack={null} audioTrack={track(remote, "audio")} style={{ width: 1, height: 1 }} />}
          <Text style={{ color: "#cbd5e1", fontSize: 18 }}>
            {phase === "joining" ? "Connecting…" : remote ? `${remote.user_name}'s camera is off` : "Waiting for the other person to join…"}
          </Text>
        </View>
      )}

      <SafeAreaView style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <View style={st.topBar}>
          <View style={st.pill}><Text style={st.pillText}>{phase === "connected" ? "Connected" : phase === "waiting" ? "Waiting" : "Connecting"}</Text></View>
          {mm ? (
            <View style={[st.pill, remaining! <= 60 && { backgroundColor: "#b91c1c" }]} accessibilityLabel={`Time left ${mm}`}>
              <Text style={st.pillText}>{mm} left</Text>
            </View>
          ) : null}
        </View>

        {camOn && track(local, "video") ? (
          <View style={st.selfView}>
            <DailyMediaView videoTrack={track(local, "video")} audioTrack={null} mirror objectFit="cover" zOrder={1} style={st.fill} />
          </View>
        ) : null}

        <View style={{ flex: 1 }} pointerEvents="none" />
        {error ? <Text style={st.warn}>{error}</Text> : null}
        <Text style={st.notice}>This visit may be monitored by facility staff.</Text>
        <View style={st.controls}>
          <CtrlButton icon={micOn ? "mic" : "mic-off"} label={micOn ? "Mute microphone" : "Unmute microphone"} onPress={toggleMic} active={!micOn} />
          <CtrlButton icon={camOn ? "videocam" : "videocam-off"} label={camOn ? "Turn camera off" : "Turn camera on"} onPress={toggleCam} active={!camOn} />
          <CtrlButton icon="camera-reverse" label="Switch camera" onPress={flip} />
          <CtrlButton icon="call" label="Leave visit" onPress={() => call.current?.leave()} danger />
        </View>
      </SafeAreaView>
    </View>
  );
}

function CtrlButton({ icon, label, onPress, active, danger }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; active?: boolean; danger?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }}
      style={({ pressed }) => [st.ctrl, active && { backgroundColor: "#f8fafc" }, danger && { backgroundColor: "#dc2626" }, pressed && { opacity: 0.7 }]}>
      <Ionicons name={icon} size={26} color={active ? "#0f172a" : "#fff"} style={danger ? { transform: [{ rotate: "135deg" }] } : undefined} />
    </Pressable>
  );
}

const st = StyleSheet.create({
  fill: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center" },
  topBar: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: space(4), paddingTop: space(2) },
  pill: { backgroundColor: "rgba(15,23,42,0.7)", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  pillText: { color: "#fff", fontWeight: "600", fontSize: 14, fontVariant: ["tabular-nums"] },
  selfView: { position: "absolute", right: space(4), top: 70, width: 110, height: 160, borderRadius: 14, overflow: "hidden", borderWidth: 2, borderColor: "rgba(255,255,255,0.5)", backgroundColor: "#1e293b" },
  notice: { color: "#cbd5e1", fontSize: 13, textAlign: "center", marginBottom: space(3) },
  warn: { color: "#fecaca", fontSize: 14, textAlign: "center", marginHorizontal: space(4), marginBottom: space(2) },
  controls: { flexDirection: "row", justifyContent: "center", gap: space(5), paddingBottom: space(4) },
  ctrl: { width: 60, height: 60, borderRadius: 30, backgroundColor: "rgba(51,65,85,0.85)", alignItems: "center", justifyContent: "center" },
});
