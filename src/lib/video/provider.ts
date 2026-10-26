// Thin seam over the hosted WebRTC provider so Daily could be swapped for LiveKit Cloud
// without touching routes or pages. No media servers live in this project.
export interface VideoProvider {
  createRoom(name: string, expiresAt: Date): Promise<{ name: string; url: string }>;
  createToken(opts: { room: string; userName: string; userId: string; observer: boolean; expiresAt: Date }): Promise<string>;
  deleteRoom(name: string): Promise<void>;
}
