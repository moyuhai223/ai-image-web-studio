import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getImageForUser, setImageTagsForUser } from "@/lib/repository";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await context.params;
  const image = await getImageForUser(id, user);
  if (!image) {
    return NextResponse.json({ error: "图片不存在或无权访问" }, { status: 404 });
  }

  return NextResponse.json({ tags: image.tags ?? [] }, { headers: { "cache-control": "no-store" } });
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { tags?: unknown };
  const tags = await setImageTagsForUser(id, body.tags, user);
  if (!tags) {
    return NextResponse.json({ error: "图片不存在或无权修改" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, tags });
}
