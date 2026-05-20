import { AppNav } from "@/components/app-nav";
import { Workspace } from "@/components/workspace";
import { requireUser } from "@/lib/auth";
import { listPromptTemplates } from "@/lib/prompt-templates";
import { listRecentReferenceImagesForUser } from "@/lib/repository";
import { getUiThemePreference } from "@/lib/ui-theme";
import { modelOptions } from "@/lib/validation";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await requireUser();
  const [templates, themePreference, recentReferenceImages] = await Promise.all([
    listPromptTemplates(),
    getUiThemePreference(),
    listRecentReferenceImagesForUser(user, 5)
  ]);
  const recentReferencePreview = recentReferenceImages.map((reference) => ({
    id: reference.id,
    byte_size: reference.byte_size
  }));

  return (
    <div className="shell" data-theme={themePreference.theme}>
      <AppNav user={user} themeMode={themePreference.mode} />
      <main className="main">
        <Workspace models={modelOptions} promptTemplates={templates} recentReferenceImages={recentReferencePreview} />
      </main>
    </div>
  );
}
