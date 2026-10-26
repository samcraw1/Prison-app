import { requireRole } from "@/lib/auth";
import { VideoRoom } from "@/components/VideoRoom";

export default async function ResidentVisitRoom({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireRole(["resident"]);
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-semibold">Video visit</h1>
      <VideoRoom visitId={id} backHref="/resident/visits" large />
    </div>
  );
}
