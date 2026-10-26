import { requireRole } from "@/lib/auth";
import { VideoRoom } from "@/components/VideoRoom";

export default async function FamilyVisitRoom({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireRole(["family"]);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Video visit</h1>
      <VideoRoom visitId={id} backHref="/family/visits" />
    </div>
  );
}
