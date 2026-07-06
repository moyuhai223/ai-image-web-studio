import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { startGenerationQueue } from "@/lib/generation-queue";
import { getActiveQueueStats, listActiveQueueJobs } from "@/lib/repository";
import { getMaxGenerationConcurrency } from "@/lib/usage-limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await requireUser();
  startGenerationQueue();
  const [stats, jobs, concurrency] = await Promise.all([
    getActiveQueueStats(user),
    listActiveQueueJobs(user, 8),
    getMaxGenerationConcurrency()
  ]);

  return NextResponse.json(
    {
      ...stats,
      concurrency,
      jobs
    },
    {
      headers: {
        "cache-control": "no-store"
      }
    }
  );
}
