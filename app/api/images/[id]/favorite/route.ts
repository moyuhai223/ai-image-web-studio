import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { setImageFavoriteForUser } from "@/lib/repository";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { favorite?: unknown };
  const favorite = body.favorite !== false;
  const isFavorite = await setImageFavoriteForUser(id, user, favorite);

  if (isFavorite === null) {
    return NextResponse.json({ error: "图片不存在或无权访问" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, isFavorite });
}
