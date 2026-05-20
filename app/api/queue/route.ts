import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { startGenerationQueue } from "@/lib/generation-queue";
import { getActiveQueueStats, listActiveQueueJobs } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await requireUser();
  startGenerationQueue();
  const [stats, jobs] = await Promise.all([
    getActiveQueueStats(user),
    listActiveQueueJobs(user, 8)
  ]);

  return NextResponse.json(
    {
      ...stats,
      concurrency: config.maxGenerationConcurrency,
      jobs
    },
    {
      headers: {
        "cache-control": "no-store"
      }
    }
  );
}
