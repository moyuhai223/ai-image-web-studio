import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { listImageTagsForUser } from "@/lib/repository";

export const runtime = "nodejs";

export async function GET() {
  const user = await requireUser();
  const tags = await listImageTagsForUser(user);
  return NextResponse.json({ tags }, { headers: { "cache-control": "private, max-age=15" } });
}
