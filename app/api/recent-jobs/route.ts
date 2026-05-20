import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { listRecentJobs } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await requireUser();
  const jobs = await listRecentJobs(user, 6);

  return NextResponse.json(
    { jobs },
    {
      headers: {
        "cache-control": "private, max-age=15"
      }
    }
  );
}
