import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { VideoRoom } from "@/components/VideoRoom";
import { EndVisitButton } from "../EndVisitButton";

export default async function StaffWatchVisit({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireRole(["staff", "admin"]);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/staff/visits" className="text-sm text-blue-800 underline">← Visits</Link>
          <h1 className="text-xl font-semibold">Live visit</h1>
        </div>
        <EndVisitButton visitId={id} />
      </div>
      <VideoRoom visitId={id} backHref="/staff/visits" />
    </div>
  );
}
