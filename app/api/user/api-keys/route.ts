import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit-log";
import { respondError } from "@/lib/api-errors";
import { createApiKey, listApiKeys, revokeApiKey } from "@/lib/api-keys";
import { requireUser } from "@/lib/auth";
import { crossOriginViolation } from "@/lib/request-guard";

export const runtime = "nodejs";

const createSchema = z.object({
  name: z.string().trim().max(40, "名称太长").default("")
});

export async function GET() {
  const user = await requireUser();
  try {
    return NextResponse.json({ keys: await listApiKeys(user) });
  } catch (error) {
    return respondError(error, { context: "user.apiKeys.GET", fallbackStatus: 500 });
  }
}

export async function POST(request: Request) {
  if (crossOriginViolation(request)) {
    return NextResponse.json({ error: "跨站请求被拒绝" }, { status: 403 });
  }
  const user = await requireUser();
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "参数无效" }, { status: 400 });
    }

    const { plaintext, item } = await createApiKey(user.id, parsed.data.name);
    // 审计详情只写前缀,绝不含明文/哈希
    await writeAuditLog({
      user,
      request,
      action: "创建 API Key",
      targetType: "api_key",
      targetId: item.id,
      detail: { name: item.name, keyPrefix: item.key_prefix }
    });
    return NextResponse.json({ key: plaintext, item }, { status: 201 });
  } catch (error) {
    return respondError(error, { context: "user.apiKeys.POST", fallbackStatus: 400 });
  }
}

export async function DELETE(request: Request) {
  if (crossOriginViolation(request)) {
    return NextResponse.json({ error: "跨站请求被拒绝" }, { status: 403 });
  }
  const user = await requireUser();
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const id = typeof body.id === "string" ? body.id.trim() : "";
    // uuid 预校验:避免非法值绑到 uuid 列时把 pg 原始错误文本透传给客户端
    if (!id || !z.string().uuid().safeParse(id).success) {
      return NextResponse.json({ error: "请提供要吊销的 Key id" }, { status: 400 });
    }

    const revoked = await revokeApiKey(id, user);
    if (!revoked) {
      return NextResponse.json({ error: "Key 不存在、已吊销或无权操作" }, { status: 404 });
    }
    await writeAuditLog({
      user,
      request,
      action: "吊销 API Key",
      targetType: "api_key",
      targetId: revoked.id,
      detail: { name: revoked.name, keyPrefix: revoked.key_prefix }
    });
    return NextResponse.json({ item: revoked });
  } catch (error) {
    return respondError(error, { context: "user.apiKeys.DELETE", fallbackStatus: 400 });
  }
}
