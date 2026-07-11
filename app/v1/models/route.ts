import { NextResponse } from "next/server";
import { authenticateApiKey, invalidApiKeyResponse } from "@/lib/api-key-auth";
import { listDistinctModelValues } from "@/lib/model-groups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** OpenAI 兼容:GET /v1/models——列出可用模型,兼作 API Key 连接测试。 */
export async function GET(request: Request) {
  const auth = await authenticateApiKey(request);
  if (!auth) return invalidApiKeyResponse();

  const models = await listDistinctModelValues();
  return NextResponse.json({
    object: "list",
    data: models.map((m) => ({
      id: m.value,
      object: "model",
      created: 0,
      owned_by: "ai-image-web-studio"
    }))
  });
}
