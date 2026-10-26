import type { VideoProvider } from "./provider";

const unix = (d: Date) => Math.floor(d.getTime() / 1000);

export function createDailyProvider(apiKey: string, baseUrl = "https://api.daily.co/v1"): VideoProvider {
  async function call(path: string, init: RequestInit = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}`, ...init.headers },
      cache: "no-store",
    });
    return res;
  }

  return {
    async createRoom(name, expiresAt) {
      // NOTE (recording): a production version would add `enable_recording` here and persist the
      // retained recording reference in visits.recording_url, subject to the facility's retention policy.
      const res = await call("/rooms", {
        method: "POST",
        body: JSON.stringify({
          name,
          privacy: "private",
          properties: {
            exp: unix(expiresAt),
            eject_at_room_exp: true,
            max_participants: 4,
            enable_chat: false,
            enable_screenshare: false,
            enable_knocking: false,
          },
        }),
      });
      if (res.ok) {
        const room = await res.json();
        return { name: room.name, url: room.url };
      }
      const existing = await call(`/rooms/${encodeURIComponent(name)}`);
      if (existing.ok) {
        const room = await existing.json();
        return { name: room.name, url: room.url };
      }
      throw new Error(`Daily createRoom failed (${res.status})`);
    },

    async createToken({ room, userName, userId, observer, expiresAt }) {
      const res = await call("/meeting-tokens", {
        method: "POST",
        body: JSON.stringify({
          properties: {
            room_name: room,
            user_name: userName,
            user_id: userId,
            exp: unix(expiresAt),
            is_owner: false,
            enable_screenshare: false,
            // Staff watching a visit are hidden, receive-only observers.
            ...(observer ? { permissions: { hasPresence: false, canSend: false } } : {}),
          },
        }),
      });
      if (!res.ok) throw new Error(`Daily createToken failed (${res.status})`);
      return (await res.json()).token as string;
    },

    async deleteRoom(name) {
      const res = await call(`/rooms/${encodeURIComponent(name)}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw new Error(`Daily deleteRoom failed (${res.status})`);
    },
  };
}

export function getVideoProvider(): VideoProvider | null {
  const key = process.env.DAILY_API_KEY;
  if (!key) return null;
  return createDailyProvider(key, process.env.DAILY_API_URL || undefined);
}
