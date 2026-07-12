import { AppNav } from "@/components/app-nav";
import { StudioWorkspace } from "@/components/studio/studio-workspace";
import { requireUser } from "@/lib/auth";
import { listPromptTemplates } from "@/lib/prompt-templates";
import { getPromptOptimizeSummary } from "@/lib/prompt-optimize-settings";
import { listGroupModelOptions, getDefaultGroupId } from "@/lib/model-groups";
import { listRecentReferenceImagesForUser } from "@/lib/repository";
import { getUiThemePreference } from "@/lib/ui-theme";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await requireUser();
  const [templates, themePreference, recentReferenceImages, promptOptimize, groupModelOptions, defaultGroupId] =
    await Promise.all([
      listPromptTemplates(),
      getUiThemePreference(),
      listRecentReferenceImagesForUser(user, 5),
      getPromptOptimizeSummary(),
      listGroupModelOptions(),
      getDefaultGroupId()
    ]);
  const recentReferencePreview = recentReferenceImages.map((reference) => ({
    id: reference.id,
    byte_size: reference.byte_size
  }));

  // Studio Console 布局:整页不滚(>1320 三栏各自内滚 + 底部 Composer),不渲染页脚
  // (版本信息顶栏 version-pill 已有)。
  return (
    <div className="shell studio-shell" data-theme={themePreference.theme}>
      <AppNav user={user} themeMode={themePreference.mode} />
      <main className="main studio-main">
        <StudioWorkspace
          groupModelOptions={groupModelOptions}
          defaultGroupId={defaultGroupId}
          promptTemplates={templates}
          recentReferenceImages={recentReferencePreview}
          promptOptimizeEnabled={promptOptimize.enabled && promptOptimize.hasApiKey}
        />
      </main>
    </div>
  );
}
