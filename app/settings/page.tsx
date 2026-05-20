import { DatabaseZap, FileClock, FileText, ImageIcon, KeyRound, ShieldCheck, Users } from "lucide-react";
import { AppNav } from "@/components/app-nav";
import { AiKeysForm } from "@/components/ai-keys-form";
import { AuditLogPanel } from "@/components/audit-log-panel";
import { CreateUserForm } from "@/components/create-user-form";
import { DataBackupPanel } from "@/components/data-backup-panel";
import { PromptTemplatesPanel } from "@/components/prompt-templates-panel";
import { ProviderSettingsForm } from "@/components/provider-settings-form";
import { ReferenceImagesPanel } from "@/components/reference-images-panel";
import { StorageMaintenancePanel } from "@/components/storage-maintenance-panel";
import { SystemHealthCard } from "@/components/system-health-card";
import { UserSecurityPanel } from "@/components/user-security-panel";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";
import { config } from "@/lib/config";
import { listAiKeySummaries } from "@/lib/api-keys";
import { getSystemHealth } from "@/lib/health";
import { getProviderSettings } from "@/lib/provider-settings";
import { listPromptTemplates } from "@/lib/prompt-templates";
import { getUiThemePreference } from "@/lib/ui-theme";
import { APP_VERSION_LABEL } from "@/lib/version";
import type { User } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireAdmin();
  const [users, aiKeys, health, providerSettings, promptTemplates, themePreference] = await Promise.all([
    query<User>(`select id, username, role, active, created_at, updated_at from users order by created_at desc`),
    listAiKeySummaries(),
    getSystemHealth(),
    getProviderSettings(),
    listPromptTemplates(),
    getUiThemePreference()
  ]);

  return (
    <div className="shell" data-theme={themePreference.theme}>
      <AppNav user={user} themeMode={themePreference.mode} />
      <main className="main settings-main">
        <div className="settings-layout">
          <aside className="settings-nav" aria-label="设置分组">
            <a href="#settings-system" aria-label="系统状态" title="系统状态">
              <ShieldCheck size={15} />
              <span>系统状态</span>
            </a>
            <a href="#settings-keys" aria-label="Key 管理" title="Key 管理">
              <KeyRound size={15} />
              <span>Key 管理</span>
            </a>
            <a href="#settings-users" aria-label="用户管理" title="用户管理">
              <Users size={15} />
              <span>用户管理</span>
            </a>
            <a href="#settings-templates" aria-label="提示词模板" title="提示词模板">
              <FileText size={15} />
              <span>提示词模板</span>
            </a>
            <a href="#settings-references" aria-label="参考图" title="参考图">
              <ImageIcon size={15} />
              <span>参考图</span>
            </a>
            <a href="#settings-maintenance" aria-label="维护操作" title="维护操作">
              <DatabaseZap size={15} />
              <span>维护操作</span>
            </a>
            <a href="#settings-audit" aria-label="审计日志" title="审计日志">
              <FileClock size={15} />
              <span>审计日志</span>
            </a>
          </aside>
          <div className="settings-sections">
            <details className="settings-section settings-fold" id="settings-system" open>
              <summary>
                <ShieldCheck size={15} />
                <span>系统状态</span>
              </summary>
              <SystemHealthCard health={health} />
              <section className="panel">
                <div className="panel-header">
                  <h1 className="panel-title">运行设置</h1>
                </div>
                <div className="panel-body form-stack">
                  <ProviderSettingsForm aiBaseUrl={providerSettings.aiBaseUrl} source={providerSettings.source} />
                  <div className="actions">
                    <span className="status">版本: {APP_VERSION_LABEL}</span>
                    <span className="status">主题: 顶部菜单自选</span>
                    <span className="status">Base URL: {providerSettings.aiBaseUrl}</span>
                    <span className="status">时区: {config.timeZone}</span>
                    <span className="status">存储: {config.storageRoot}</span>
                    <span className="status">并发: {config.maxGenerationConcurrency}</span>
                    <span className="status">每日上限: {config.dailyGenerationLimit > 0 ? config.dailyGenerationLimit : "不限"}</span>
                  </div>
                </div>
              </section>
            </details>

            <details className="settings-section settings-fold" id="settings-keys" open>
              <summary>
                <KeyRound size={15} />
                <span>Key 管理</span>
              </summary>
              <AiKeysForm
                keys={aiKeys.keys}
                hasEnvFallback={Boolean(config.aiApiKey)}
                autoDisableEnabled={aiKeys.autoDisableEnabled}
                autoDisableFailureThreshold={aiKeys.autoDisableFailureThreshold}
              />
            </details>

            <details className="settings-section settings-fold" id="settings-users" open>
              <summary>
                <Users size={15} />
                <span>用户管理</span>
              </summary>
              <CreateUserForm />
              <UserSecurityPanel users={users.rows} currentUserId={user.id} dailyLimit={config.dailyGenerationLimit} />
            </details>

            <details className="settings-section settings-fold" id="settings-templates" open>
              <summary>
                <FileText size={15} />
                <span>提示词模板</span>
              </summary>
              <PromptTemplatesPanel templates={promptTemplates} />
            </details>

            <details className="settings-section settings-fold" id="settings-references" open>
              <summary>
                <ImageIcon size={15} />
                <span>参考图</span>
              </summary>
              <ReferenceImagesPanel />
            </details>

            <details className="settings-section settings-fold" id="settings-maintenance">
              <summary>
                <DatabaseZap size={15} />
                <span>维护操作</span>
              </summary>
              <div className="maintenance-stack">
                <StorageMaintenancePanel />
                <DataBackupPanel />
              </div>
            </details>

            <details className="settings-section settings-fold" id="settings-audit" open>
              <summary>
                <FileClock size={15} />
                <span>审计日志</span>
              </summary>
              <AuditLogPanel />
            </details>
          </div>
        </div>
      </main>
    </div>
  );
}
