import { useCallback, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

// The backend has no read receipts, so "new message" is tracked on this device: a thread is unread when its
// newest delivered resident message arrived after the user last opened that thread here. On first use the
// baseline is "now", so existing history is not flagged as new. Stores timestamps only, no message content.
const key = (userId: string) => `clearline.lastSeen.${userId}`;
type Seen = { baseline: string; threads: Record<string, string> };

const listeners = new Set<() => void>();

async function load(userId: string): Promise<Seen> {
  const raw = await AsyncStorage.getItem(key(userId));
  if (raw) return JSON.parse(raw) as Seen;
  const fresh: Seen = { baseline: new Date().toISOString(), threads: {} };
  await AsyncStorage.setItem(key(userId), JSON.stringify(fresh));
  return fresh;
}

export async function markThreadSeen(userId: string, contactId: string, at = new Date().toISOString()) {
  const seen = await load(userId);
  if ((seen.threads[contactId] ?? "") >= at) return;
  seen.threads[contactId] = at;
  await AsyncStorage.setItem(key(userId), JSON.stringify(seen));
  listeners.forEach((l) => l());
}

export function useSeen(userId: string | undefined) {
  const [seen, setSeen] = useState<Seen>();
  const reload = useCallback(() => { if (userId) load(userId).then(setSeen); }, [userId]);
  useEffect(() => {
    reload();
    listeners.add(reload);
    return () => { listeners.delete(reload); };
  }, [reload]);
  const isUnread = useCallback(
    (contactId: string, latestIncoming: string | undefined) => {
      if (!seen || !latestIncoming) return false;
      return latestIncoming > (seen.threads[contactId] ?? seen.baseline);
    },
    [seen],
  );
  return isUnread;
}
