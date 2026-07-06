import { AppNav } from "@/components/app-nav";
import { AppFooter } from "@/components/app-footer";
import { AuditLogPanel } from "@/components/audit-log-panel";
import { CacheGuidePanel } from "@/components/cache-guide-panel";
import { CreateUserForm } from "@/components/create-user-form";
import { DataBackupPanel } from "@/components/data-backup-panel";
import { ModelGroupsManager } from "@/components/model-groups-manager";
import { PromptTemplatesPanel } from "@/components/prompt-templates-panel";
import { PromptOptimizePanel } from "@/components/prompt-optimize-panel";
import { ReferenceImagesPanel } from "@/components/reference-images-panel";
import { SettingsTabs } from "@/components/settings-tabs";
import { StorageMaintenancePanel } from "@/components/storage-maintenance-panel";
import { SystemHealthCard } from "@/components/system-health-card";
import { UpdateCheckPanel } from "@/components/update-check-panel";
import { UserSecurityPanel } from "@/components/user-security-panel";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";
import { config } from "@/lib/config";
import { getSystemHealth } from "@/lib/health";
import { getOperationalMetrics } from "@/lib/metrics";
import { listModelGroups } from "@/lib/model-groups";
import { listPromptTemplates } from "@/lib/prompt-templates";
import {
  getPromptOptimizeSummary,
  DEFAULT_OPTIMIZE_SYSTEM_PROMPT,
  DEFAULT_OPTIMIZE_MODEL
} from "@/lib/prompt-optimize-settings";
import { getUiThemePreference } from "@/lib/ui-theme";
import { getDailyGenerationLimit } from "@/lib/usage-limits";
import { APP_VERSION_LABEL } from "@/lib/version";
import type { User } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireAdmin();
  const [users, health, modelGroups, promptTemplates, promptOptimize, themePreference, metrics, dailyGenerationLimit] =
    await Promise.all([
      query<User>(`select id, username, role, active, must_change_password, session_epoch, created_at, updated_at from users order by created_at desc`),
      getSystemHealth(),
      listModelGroups(),
      listPromptTemplates(),
      getPromptOptimizeSummary(),
      getUiThemePreference(),
      getOperationalMetrics(),
      getDailyGenerationLimit()
    ]);
  const defaultGroup = modelGroups.find((group) => group.isDefault) ?? modelGroups[0] ?? null;

  return (
    <div className="shell" data-theme={themePreference.theme}>
      <AppNav user={user} themeMode={themePreference.mode} />
      <main className="main settings-main">
        <SettingsTabs
          system={
            <>
              <SystemHealthCard health={health} metrics={metrics} />
              <UpdateCheckPanel currentVersion={APP_VERSION_LABEL.replace(/^v/, "")} repository={config.githubRepositorySlug} />
              <section className="panel">
                <div className="panel-header">
                  <h1 className="panel-title">运行设置</h1>
                </div>
                <div className="panel-body form-stack">
                  <div className="actions">
                    <span className="status">版本: {APP_VERSION_LABEL}</span>
                    <span className="status">主题: 顶部菜单自选</span>
                    <span className="status">模型组: {modelGroups.length} 组</span>
                    <span className="status">默认组: {defaultGroup?.name ?? "未配置(env 兜底)"}</span>
                    <span className="status">时区: {config.timeZone}</span>
                    <span className="status">存储: {config.storageRoot}</span>
                    <span className="status">并发: {config.maxGenerationConcurrency}</span>
                    <span className="status">每日上限: {dailyGenerationLimit > 0 ? dailyGenerationLimit : "不限"}</span>
                  </div>
                </div>
              </section>
            </>
          }
          groups={<ModelGroupsManager groups={modelGroups} />}
          users={
            <>
              <CreateUserForm />
              <UserSecurityPanel users={users.rows} currentUserId={user.id} dailyLimit={dailyGenerationLimit} />
            </>
          }
          templates={
            <>
              <PromptOptimizePanel
                settings={promptOptimize}
                defaultSystemPrompt={DEFAULT_OPTIMIZE_SYSTEM_PROMPT}
                defaultModel={DEFAULT_OPTIMIZE_MODEL}
              />
              <PromptTemplatesPanel templates={promptTemplates} />
            </>
          }
          references={
            <ReferenceImagesPanel />
          }
          maintenance={
            <div className="maintenance-stack">
              <StorageMaintenancePanel />
              <DataBackupPanel />
            </div>
          }
          cache={<CacheGuidePanel />}
          audit={
            <AuditLogPanel />
          }
        />
      </main>
      <AppFooter />
    </div>
  );
}
