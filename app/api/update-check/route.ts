import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { checkForUpdates } from "@/lib/update-check";

export const runtime = "nodejs";

export async function GET() {
  await requireAdmin();
  const result = await checkForUpdates();
  return NextResponse.json(result, {
    status: result.error ? 502 : 200,
    headers: {
      "cache-control": "private, no-store"
    }
  });
}
