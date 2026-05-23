import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { respondError } from "@/lib/api-errors";
import { listProviderPresetSummaries } from "@/lib/provider-settings";

export const runtime = "nodejs";

/**
 * 普通用户可见的 Preset 列表。只暴露 id / name / isDefault,
 * 不暴露 baseUrl 也不暴露关联 key 信息。供 workspace 顶部下拉用。
 */
export async function GET() {
  await requireUser();
  try {
    const presets = await listProviderPresetSummaries();
    return NextResponse.json({
      presets: presets.map(({ id, name, isDefault }) => ({ id, name, isDefault })),
      defaultPresetId: presets.find((preset) => preset.isDefault)?.id ?? null
    });
  } catch (error) {
    return respondError(error, { context: "presets.GET", fallbackStatus: 500 });
  }
}
