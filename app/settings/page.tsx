import { AppNav } from "@/components/app-nav";
import { AppFooter } from "@/components/app-footer";
import { AiKeysForm } from "@/components/ai-keys-form";
import { AuditLogPanel } from "@/components/audit-log-panel";
import { CacheGuidePanel } from "@/components/cache-guide-panel";
import { CreateUserForm } from "@/components/create-user-form";
import { DataBackupPanel } from "@/components/data-backup-panel";
import { PresetsManager } from "@/components/presets-manager";
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
import { listAiKeySummaries } from "@/lib/api-keys";
import { getSystemHealth } from "@/lib/health";
import { getOperationalMetrics } from "@/lib/metrics";
import { getProviderSettings } from "@/lib/provider-settings";
import { listPromptTemplates } from "@/lib/prompt-templates";
import {
  getPromptOptimizeSummary,
  DEFAULT_OPTIMIZE_SYSTEM_PROMPT,
  DEFAULT_OPTIMIZE_MODEL
} from "@/lib/prompt-optimize-settings";
import { getUiThemePreference } from "@/lib/ui-theme";
import { APP_VERSION_LABEL } from "@/lib/version";
import type { User } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireAdmin();
  const [users, aiKeys, health, providerSettings, promptTemplates, promptOptimize, themePreference, metrics] =
    await Promise.all([
      query<User>(`select id, username, role, active, created_at, updated_at from users order by created_at desc`),
      listAiKeySummaries(),
      getSystemHealth(),
      getProviderSettings(),
      listPromptTemplates(),
      getPromptOptimizeSummary(),
      getUiThemePreference(),
      getOperationalMetrics()
    ]);

  return (
    <div className="shell" data-theme={themePreference.theme}>
      <AppNav user={user} themeMode={themePreference.mode} />
      <main className="main settings-main">
        <SettingsTabs
          system={
            <>
              <SystemHealthCard health={health} metrics={metrics} />
              <UpdateCheckPanel currentVersion={APP_VERSION_LABEL.replace(/^v/, "")} repository={config.githubRepositorySlug} />
              <PresetsManager
                presets={providerSettings.presets}
                fallbackAiBaseUrl={providerSettings.aiBaseUrl}
                fallbackSource={providerSettings.source}
              />
              <section className="panel">
                <div className="panel-header">
                  <h1 className="panel-title">运行设置</h1>
                </div>
                <div className="panel-body form-stack">
                  <div className="actions">
                    <span className="status">版本: {APP_VERSION_LABEL}</span>
                    <span className="status">主题: 顶部菜单自选</span>
                    <span className="status">默认 Base URL: {providerSettings.aiBaseUrl || "未配置"}</span>
                    <span className="status">Preset 数量: {providerSettings.presets.length}</span>
                    <span className="status">时区: {config.timeZone}</span>
                    <span className="status">存储: {config.storageRoot}</span>
                    <span className="status">并发: {config.maxGenerationConcurrency}</span>
                    <span className="status">每日上限: {config.dailyGenerationLimit > 0 ? config.dailyGenerationLimit : "不限"}</span>
                  </div>
                </div>
              </section>
            </>
          }
          keys={
            <AiKeysForm
              keys={aiKeys.keys}
              hasEnvFallback={Boolean(config.aiApiKey)}
              autoDisableEnabled={aiKeys.autoDisableEnabled}
              autoDisableFailureThreshold={aiKeys.autoDisableFailureThreshold}
              presets={providerSettings.presets.map((preset) => ({
                id: preset.id,
                name: preset.name,
                isDefault: preset.isDefault
              }))}
            />
          }
          users={
            <>
              <CreateUserForm />
              <UserSecurityPanel users={users.rows} currentUserId={user.id} dailyLimit={config.dailyGenerationLimit} />
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
