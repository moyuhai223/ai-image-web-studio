"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Activity, CheckCircle2, LinkIcon, Pencil, Plus, Star, Trash2, X } from "lucide-react";
import type { ProviderPreset } from "@/lib/provider-settings";
import { DangerConfirmDialog } from "./danger-confirm-dialog";

type Props = {
  presets: ProviderPreset[];
  fallbackAiBaseUrl: string;
  fallbackSource: "database" | "env";
};

type ApiResponse = {
  error?: string;
};

type TestResponse = {
  ok: boolean;
  status: number | null;
  latencyMs: number;
  baseUrl: string;
  keyLabel: string | null;
  error?: string;
};

type TestResultState = {
  ok: boolean;
  latencyMs: number;
  status: number | null;
  keyLabel: string | null;
  error?: string;
  checkedAt: number;
};

export function PresetsManager({ presets, fallbackAiBaseUrl, fallbackSource }: Props) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [createLoading, setCreateLoading] = useState(false);
  const [newName, setNewName] = useState("");
  const [newBaseUrl, setNewBaseUrl] = useState("");
  const [newIsDefault, setNewIsDefault] = useState(presets.length === 0);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editBaseUrl, setEditBaseUrl] = useState("");
  const [editLoading, setEditLoading] = useState(false);

  const [defaultLoadingId, setDefaultLoadingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");

  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResultState>>({});

  async function testConnection(id: string) {
    setTestingId(id);
    try {
      const response = await fetch("/api/settings/presets/test-connection", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id })
      });
      const data = (await response.json().catch(() => ({}))) as TestResponse & ApiResponse;
      if (!response.ok) {
        setTestResults((prev) => ({
          ...prev,
          [id]: {
            ok: false,
            latencyMs: 0,
            status: null,
            keyLabel: null,
            error: data.error ?? `请求失败 (HTTP ${response.status})`,
            checkedAt: Date.now()
          }
        }));
        return;
      }
      setTestResults((prev) => ({
        ...prev,
        [id]: {
          ok: data.ok,
          latencyMs: data.latencyMs,
          status: data.status,
          keyLabel: data.keyLabel,
          error: data.error,
          checkedAt: Date.now()
        }
      }));
    } catch (error) {
      setTestResults((prev) => ({
        ...prev,
        [id]: {
          ok: false,
          latencyMs: 0,
          status: null,
          keyLabel: null,
          error: error instanceof Error ? error.message : "网络错误",
          checkedAt: Date.now()
        }
      }));
    } finally {
      setTestingId(null);
    }
  }

  async function createPreset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setCreateLoading(true);
    const response = await fetch("/api/settings/presets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: newName, baseUrl: newBaseUrl, isDefault: newIsDefault })
    });
    const data = (await response.json().catch(() => ({}))) as ApiResponse;
    setCreateLoading(false);
    if (!response.ok) {
      setMessage(data.error ?? "新增 Preset 失败");
      return;
    }
    setMessage("Preset 已新增");
    setNewName("");
    setNewBaseUrl("");
    setNewIsDefault(false);
    router.refresh();
  }

  function startEdit(preset: ProviderPreset) {
    setEditingId(preset.id);
    setEditName(preset.name);
    setEditBaseUrl(preset.baseUrl);
    setMessage("");
  }

  function cancelEdit() {
    if (editLoading) return;
    setEditingId(null);
    setEditName("");
    setEditBaseUrl("");
  }

  async function saveEdit(id: string) {
    setMessage("");
    setEditLoading(true);
    const response = await fetch("/api/settings/presets", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, name: editName, baseUrl: editBaseUrl })
    });
    const data = (await response.json().catch(() => ({}))) as ApiResponse;
    setEditLoading(false);
    if (!response.ok) {
      setMessage(data.error ?? "保存 Preset 失败");
      return;
    }
    setEditingId(null);
    setMessage("Preset 已更新");
    router.refresh();
  }

  async function setAsDefault(id: string) {
    setMessage("");
    setDefaultLoadingId(id);
    const response = await fetch("/api/settings/presets", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, action: "set-default" })
    });
    const data = (await response.json().catch(() => ({}))) as ApiResponse;
    setDefaultLoadingId(null);
    if (!response.ok) {
      setMessage(data.error ?? "设置默认失败");
      return;
    }
    setMessage("已设为默认 Preset");
    router.refresh();
  }

  async function deletePreset(id: string) {
    setDeleteError("");
    setDeletingId(id);
    setMessage("");
    const response = await fetch("/api/settings/presets", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id })
    });
    const data = (await response.json().catch(() => ({}))) as ApiResponse;
    setDeletingId(null);
    if (!response.ok) {
      setDeleteError(data.error ?? "删除失败");
      return;
    }
    setConfirmDeleteId(null);
    setMessage("Preset 已删除");
    router.refresh();
  }

  function openDeleteConfirm(id: string) {
    setDeleteError("");
    setConfirmDeleteId(id);
  }

  function closeDeleteConfirm() {
    if (deletingId) return;
    setConfirmDeleteId(null);
    setDeleteError("");
  }

  const deletingPreset = presets.find((preset) => preset.id === confirmDeleteId);
  const defaultPreset = presets.find((preset) => preset.isDefault) ?? null;

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 className="panel-title">
          <LinkIcon size={17} /> Provider Preset
        </h2>
        <span className="status">
          {presets.length > 0
            ? `${presets.length} 个 Preset · 默认 ${defaultPreset?.name ?? "未设置"}`
            : fallbackSource === "env"
              ? "使用 .env Base URL"
              : "未配置"}
        </span>
      </div>
      <div className="panel-body form-stack">
        {presets.length === 0 ? (
          <p className="small muted">
            尚未配置 Preset。
            {fallbackAiBaseUrl ? `当前使用环境变量 Base URL：${fallbackAiBaseUrl}。` : ""}
            添加第一个 Preset 后会自动设为默认。
          </p>
        ) : (
          <div className="key-list">
            {presets.map((preset) => {
              const editing = editingId === preset.id;
              const testResult = testResults[preset.id];
              return (
                <div className={`key-row ${preset.isDefault ? "" : ""}`} key={preset.id}>
                  {editing ? (
                    <div className="key-meta" style={{ width: "100%" }}>
                      <div className="field">
                        <label htmlFor={`preset-name-${preset.id}`}>名称</label>
                        <input
                          className="input"
                          id={`preset-name-${preset.id}`}
                          value={editName}
                          maxLength={64}
                          onChange={(event) => setEditName(event.target.value)}
                        />
                      </div>
                      <div className="field">
                        <label htmlFor={`preset-base-${preset.id}`}>Base URL</label>
                        <input
                          className="input"
                          id={`preset-base-${preset.id}`}
                          type="url"
                          value={editBaseUrl}
                          onChange={(event) => setEditBaseUrl(event.target.value)}
                          placeholder="https://provider.example.com"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="key-meta">
                      <div className="actions">
                        <strong>{preset.name}</strong>
                        {preset.isDefault ? (
                          <span className="status succeeded">
                            <Star size={13} /> 默认
                          </span>
                        ) : null}
                      </div>
                      <span className="small muted key-preview">{preset.baseUrl}</span>
                      <div className="key-health">
                        <span className="small muted">ID {preset.id.slice(0, 8)}</span>
                        <span className="small muted">更新 {new Date(preset.updatedAt).toLocaleString("zh-CN")}</span>
                      </div>
                      {testResult ? (
                        <p
                          className={`small ${testResult.ok ? "" : "health-error"}`}
                          style={{ margin: "4px 0 0" }}
                        >
                          {testResult.ok
                            ? `连通 · ${testResult.latencyMs}ms${testResult.status ? ` · HTTP ${testResult.status}` : ""}${
                                testResult.keyLabel ? ` · ${testResult.keyLabel}` : ""
                              }`
                            : `不可达 · ${testResult.error ?? "未知错误"}${
                                testResult.status ? ` · HTTP ${testResult.status}` : ""
                              }`}
                        </p>
                      ) : null}
                    </div>
                  )}
                  <div className="key-actions">
                    {editing ? (
                      <>
                        <button
                          className="button action-button action-save"
                          type="button"
                          disabled={editLoading}
                          onClick={() => saveEdit(preset.id)}
                        >
                          <CheckCircle2 size={16} />
                          {editLoading ? "保存中" : "保存"}
                        </button>
                        <button
                          className="status action-button action-neutral"
                          type="button"
                          disabled={editLoading}
                          onClick={cancelEdit}
                        >
                          <X size={16} /> 取消
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="button action-button action-neutral"
                          type="button"
                          disabled={testingId === preset.id}
                          onClick={() => testConnection(preset.id)}
                          title="向 Base URL 发起 /v1/models 探活"
                        >
                          <Activity size={16} />
                          {testingId === preset.id ? "测试中" : "测试连接"}
                        </button>
                        {!preset.isDefault ? (
                          <button
                            className="button action-button action-enable"
                            type="button"
                            disabled={defaultLoadingId === preset.id}
                            onClick={() => setAsDefault(preset.id)}
                          >
                            <Star size={16} />
                            {defaultLoadingId === preset.id ? "设置中" : "设为默认"}
                          </button>
                        ) : null}
                        <button
                          className="button action-button action-edit"
                          type="button"
                          onClick={() => startEdit(preset)}
                        >
                          <Pencil size={16} /> 编辑
                        </button>
                        <button
                          className="button action-button action-danger"
                          type="button"
                          disabled={preset.isDefault || deletingId === preset.id}
                          onClick={() => openDeleteConfirm(preset.id)}
                          title={preset.isDefault ? "默认 Preset 不能删除,请先把其他 Preset 设为默认" : undefined}
                        >
                          <Trash2 size={16} />
                          {deletingId === preset.id ? "删除中" : "删除"}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <form className="form-stack" onSubmit={createPreset}>
          <div className="field">
            <label htmlFor="new-preset-name">名称</label>
            <input
              className="input"
              id="new-preset-name"
              maxLength={64}
              placeholder="例如：备用 OpenAI 兼容端点"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="new-preset-base">Base URL</label>
            <input
              className="input"
              id="new-preset-base"
              type="url"
              placeholder="https://provider.example.com"
              value={newBaseUrl}
              onChange={(event) => setNewBaseUrl(event.target.value)}
              required
            />
          </div>
          <div className="field">
            <label className="status" htmlFor="new-preset-default">
              <input
                id="new-preset-default"
                type="checkbox"
                checked={newIsDefault}
                onChange={(event) => setNewIsDefault(event.target.checked)}
              />
              设为默认 Preset
            </label>
            <p className="small muted">第一个 Preset 会自动成为默认。新生成任务在未指定 Preset 时使用默认。</p>
          </div>
          <button className="button action-button action-add" type="submit" disabled={createLoading}>
            <Plus size={17} />
            {createLoading ? "保存中" : "新增 Preset"}
          </button>
        </form>

        {message ? <p className="small muted">{message}</p> : null}
      </div>
      <DangerConfirmDialog
        open={Boolean(confirmDeleteId)}
        title="确认删除 Preset"
        description={`删除 ${deletingPreset?.name ?? "该 Preset"}（${deletingPreset?.baseUrl ?? ""}）后，绑定到它的 AI Key 将无法被任何任务命中。`}
        confirmLabel="删除 Preset"
        loadingLabel="删除中"
        loading={Boolean(deletingId)}
        error={deleteError}
        confirmIcon={<Trash2 size={16} />}
        onClose={closeDeleteConfirm}
        onConfirm={() => {
          if (confirmDeleteId) void deletePreset(confirmDeleteId);
        }}
      />
    </section>
  );
}
