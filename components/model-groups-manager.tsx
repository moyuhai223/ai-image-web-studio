"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Activity, Boxes, CheckCircle2, Pencil, Plus, Star, Trash2, X } from "lucide-react";
import type { ModelGroupSummary, ModelOption } from "@/lib/model-groups";
import { DangerConfirmDialog } from "./danger-confirm-dialog";

type Props = { groups: ModelGroupSummary[] };
type ApiResponse = { error?: string };
type TestResponse = { ok: boolean; status: number | null; latencyMs: number; baseUrl: string; error?: string };
type TestResultState = { ok: boolean; latencyMs: number; status: number | null; error?: string };

const emptyModelRow = (): ModelOption => ({ value: "", label: "" });

/** 模型列表编辑器:一行 = {value, label},可增删。 */
function ModelsEditor({
  models,
  onChange,
  idPrefix
}: {
  models: ModelOption[];
  onChange: (next: ModelOption[]) => void;
  idPrefix: string;
}) {
  const update = (index: number, patch: Partial<ModelOption>) => {
    onChange(models.map((m, i) => (i === index ? { ...m, ...patch } : m)));
  };
  return (
    <div className="field">
      <label>该网关支持的模型(模型 id + 显示名)</label>
      <div className="model-rows">
        {models.map((model, index) => (
          <div className="model-row" key={`${idPrefix}-${index}`}>
            <input
              className="input"
              placeholder="模型 id,如 grok-imagine-image"
              value={model.value}
              maxLength={120}
              onChange={(event) => update(index, { value: event.target.value })}
            />
            <input
              className="input"
              placeholder="显示名(留空=用 id)"
              value={model.label}
              maxLength={80}
              onChange={(event) => update(index, { label: event.target.value })}
            />
            <button
              className="status action-button action-danger"
              type="button"
              disabled={models.length <= 1}
              onClick={() => onChange(models.filter((_, i) => i !== index))}
              title={models.length <= 1 ? "至少保留一个模型" : "删除该模型"}
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
      <button className="status action-button action-neutral" type="button" onClick={() => onChange([...models, emptyModelRow()])}>
        <Plus size={14} /> 添加模型
      </button>
    </div>
  );
}

export function ModelGroupsManager({ groups }: Props) {
  const router = useRouter();
  const [message, setMessage] = useState("");

  // 新增表单
  const [createLoading, setCreateLoading] = useState(false);
  const [newName, setNewName] = useState("");
  const [newBaseUrl, setNewBaseUrl] = useState("");
  const [newKey, setNewKey] = useState("");
  const [newModels, setNewModels] = useState<ModelOption[]>([emptyModelRow()]);
  const [newIsDefault, setNewIsDefault] = useState(groups.length === 0);

  // 编辑态
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editBaseUrl, setEditBaseUrl] = useState("");
  const [editKey, setEditKey] = useState("");
  const [editModels, setEditModels] = useState<ModelOption[]>([emptyModelRow()]);
  const [editLoading, setEditLoading] = useState(false);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResultState>>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");

  async function testConnection(payload: Record<string, unknown>, id: string) {
    setTestingId(id);
    try {
      const response = await fetch("/api/settings/model-groups/test-connection", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = (await response.json().catch(() => ({}))) as TestResponse & ApiResponse;
      setTestResults((prev) => ({
        ...prev,
        [id]: response.ok
          ? { ok: data.ok, latencyMs: data.latencyMs, status: data.status, error: data.error }
          : { ok: false, latencyMs: 0, status: null, error: data.error ?? `请求失败 (HTTP ${response.status})` }
      }));
    } catch (error) {
      setTestResults((prev) => ({
        ...prev,
        [id]: { ok: false, latencyMs: 0, status: null, error: error instanceof Error ? error.message : "网络错误" }
      }));
    } finally {
      setTestingId(null);
    }
  }

  async function createGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setCreateLoading(true);
    const response = await fetch("/api/settings/model-groups", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: newName, baseUrl: newBaseUrl, apiKey: newKey, models: newModels, isDefault: newIsDefault })
    });
    const data = (await response.json().catch(() => ({}))) as ApiResponse;
    setCreateLoading(false);
    if (!response.ok) {
      setMessage(data.error ?? "新增模型组失败");
      return;
    }
    setMessage("模型组已新增");
    setNewName("");
    setNewBaseUrl("");
    setNewKey("");
    setNewModels([emptyModelRow()]);
    setNewIsDefault(false);
    router.refresh();
  }

  function startEdit(group: ModelGroupSummary) {
    setEditingId(group.id);
    setEditName(group.name);
    setEditBaseUrl(group.baseUrl);
    setEditKey("");
    setEditModels(group.models.length ? group.models.map((m) => ({ ...m })) : [emptyModelRow()]);
    setMessage("");
  }

  function cancelEdit() {
    if (editLoading) return;
    setEditingId(null);
  }

  async function saveEdit(id: string) {
    setMessage("");
    setEditLoading(true);
    const payload: Record<string, unknown> = { id, name: editName, baseUrl: editBaseUrl, models: editModels };
    if (editKey.trim()) payload.apiKey = editKey.trim();
    const response = await fetch("/api/settings/model-groups", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = (await response.json().catch(() => ({}))) as ApiResponse;
    setEditLoading(false);
    if (!response.ok) {
      setMessage(data.error ?? "保存失败");
      return;
    }
    setEditingId(null);
    setMessage("模型组已更新");
    router.refresh();
  }

  async function patchGroup(body: Record<string, unknown>, okMsg: string) {
    setMessage("");
    setBusyId(body.id as string);
    const response = await fetch("/api/settings/model-groups", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = (await response.json().catch(() => ({}))) as ApiResponse;
    setBusyId(null);
    if (!response.ok) {
      setMessage(data.error ?? "操作失败");
      return;
    }
    setMessage(okMsg);
    router.refresh();
  }

  async function deleteGroup(id: string) {
    setDeleteError("");
    setDeletingId(id);
    const response = await fetch("/api/settings/model-groups", {
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
    setMessage("模型组已删除");
    router.refresh();
  }

  const deletingGroup = groups.find((g) => g.id === confirmDeleteId);
  const defaultGroup = groups.find((g) => g.isDefault) ?? null;

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 className="panel-title">
          <Boxes size={17} /> 模型组
        </h2>
        <span className="status">
          {groups.length > 0 ? `${groups.length} 组 · 默认 ${defaultGroup?.name ?? "未设置"}` : "未配置(用 .env 兜底)"}
        </span>
      </div>
      <div className="panel-body form-stack">
        <p className="small muted">
          一组 = 一个网关(Base URL)+ 它的 API Key + 该网关支持的模型。工作台里选模型即锁定其组的 Base URL 与 Key,不会再出现「选了模型但地址不支持」。
        </p>

        {groups.length > 0 ? (
          <div className="key-list">
            {groups.map((group) => {
              const editing = editingId === group.id;
              const test = testResults[group.id];
              return (
                <div className="key-row" key={group.id}>
                  {editing ? (
                    <div className="key-meta" style={{ width: "100%" }}>
                      <div className="field">
                        <label htmlFor={`mg-name-${group.id}`}>名称</label>
                        <input className="input" id={`mg-name-${group.id}`} value={editName} maxLength={64} onChange={(e) => setEditName(e.target.value)} />
                      </div>
                      <div className="field">
                        <label htmlFor={`mg-base-${group.id}`}>Base URL</label>
                        <input className="input" id={`mg-base-${group.id}`} type="url" value={editBaseUrl} onChange={(e) => setEditBaseUrl(e.target.value)} placeholder="https://host(结尾 /v1 会自动去掉)" />
                      </div>
                      <div className="field">
                        <label htmlFor={`mg-key-${group.id}`}>API Key(留空=不修改,当前 {group.keyPreview || "未设置"})</label>
                        <input className="input" id={`mg-key-${group.id}`} type="password" value={editKey} onChange={(e) => setEditKey(e.target.value)} placeholder="替换密钥…" autoComplete="off" />
                      </div>
                      <ModelsEditor models={editModels} onChange={setEditModels} idPrefix={`edit-${group.id}`} />
                    </div>
                  ) : (
                    <div className="key-meta">
                      <div className="actions">
                        <strong>{group.name}</strong>
                        {group.isDefault ? (
                          <span className="status succeeded">
                            <Star size={13} /> 默认
                          </span>
                        ) : null}
                        <span className={`status ${group.enabled ? "succeeded" : "failed"}`}>{group.enabled ? "启用" : "停用"}</span>
                      </div>
                      <span className="small muted key-preview">{group.baseUrl}</span>
                      <span className="small muted">Key {group.keyPreview || "未设置"} · 模型 {group.models.map((m) => m.label).join(" / ")}</span>
                      {test ? (
                        <p className={`small ${test.ok ? "" : "health-error"}`} style={{ margin: "4px 0 0" }}>
                          {test.ok
                            ? `连通 · ${test.latencyMs}ms${test.status ? ` · HTTP ${test.status}` : ""}`
                            : `不可达 · ${test.error ?? "未知错误"}${test.status ? ` · HTTP ${test.status}` : ""}`}
                        </p>
                      ) : null}
                    </div>
                  )}
                  <div className="key-actions">
                    {editing ? (
                      <>
                        <button className="button action-button action-save" type="button" disabled={editLoading} onClick={() => saveEdit(group.id)}>
                          <CheckCircle2 size={16} /> {editLoading ? "保存中" : "保存"}
                        </button>
                        <button className="status action-button action-neutral" type="button" disabled={editLoading} onClick={cancelEdit}>
                          <X size={16} /> 取消
                        </button>
                      </>
                    ) : (
                      <>
                        <button className="button action-button action-neutral" type="button" disabled={testingId === group.id} onClick={() => testConnection({ id: group.id }, group.id)} title="向 Base URL 发起 /v1/models 探活">
                          <Activity size={16} /> {testingId === group.id ? "测试中" : "测试连接"}
                        </button>
                        <button className="button action-button action-neutral" type="button" disabled={busyId === group.id} onClick={() => patchGroup({ id: group.id, enabled: !group.enabled }, group.enabled ? "已停用" : "已启用")}>
                          {group.enabled ? "停用" : "启用"}
                        </button>
                        {!group.isDefault ? (
                          <button className="button action-button action-enable" type="button" disabled={busyId === group.id} onClick={() => patchGroup({ id: group.id, action: "set-default" }, "已设为默认")}>
                            <Star size={16} /> 设为默认
                          </button>
                        ) : null}
                        <button className="button action-button action-edit" type="button" onClick={() => startEdit(group)}>
                          <Pencil size={16} /> 编辑
                        </button>
                        <button className="button action-button action-danger" type="button" disabled={deletingId === group.id || (group.isDefault && groups.length > 1)} onClick={() => { setDeleteError(""); setConfirmDeleteId(group.id); }} title={group.isDefault && groups.length > 1 ? "默认组不能删,请先把其他组设为默认" : undefined}>
                          <Trash2 size={16} /> {deletingId === group.id ? "删除中" : "删除"}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="small muted">尚未配置模型组。添加第一个组后会自动设为默认;无组时用 .env 的 Base URL + Key 兜底。</p>
        )}

        <form className="form-stack" onSubmit={createGroup}>
          <strong className="small">新增模型组</strong>
          <div className="field">
            <label htmlFor="mg-new-name">名称</label>
            <input className="input" id="mg-new-name" maxLength={64} placeholder="例如:Grok 网关 / ai.zh.ci" value={newName} onChange={(e) => setNewName(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="mg-new-base">Base URL</label>
            <input className="input" id="mg-new-base" type="url" placeholder="https://host(结尾 /v1 会自动去掉)" value={newBaseUrl} onChange={(e) => setNewBaseUrl(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="mg-new-key">API Key</label>
            <input className="input" id="mg-new-key" type="password" placeholder="该网关的 key" value={newKey} onChange={(e) => setNewKey(e.target.value)} autoComplete="off" required />
          </div>
          <ModelsEditor models={newModels} onChange={setNewModels} idPrefix="new" />
          <div className="field">
            <label className="status" htmlFor="mg-new-default">
              <input id="mg-new-default" type="checkbox" checked={newIsDefault} onChange={(e) => setNewIsDefault(e.target.checked)} />
              设为默认组
            </label>
            <p className="small muted">第一个组自动成为默认。工作台默认预选默认组的第一个模型。</p>
          </div>
          <div className="key-actions">
            <button className="button action-button action-neutral" type="button" disabled={testingId === "__new__" || !newBaseUrl} onClick={() => testConnection({ baseUrl: newBaseUrl, apiKey: newKey }, "__new__")} title="保存前先测这个 Base URL + Key">
              <Activity size={16} /> {testingId === "__new__" ? "测试中" : "测试连接"}
            </button>
            <button className="button action-button action-add" type="submit" disabled={createLoading}>
              <Plus size={17} /> {createLoading ? "保存中" : "新增模型组"}
            </button>
          </div>
          {testResults.__new__ ? (
            <p className={`small ${testResults.__new__.ok ? "" : "health-error"}`}>
              {testResults.__new__.ok ? `连通 · ${testResults.__new__.latencyMs}ms` : `不可达 · ${testResults.__new__.error ?? "未知错误"}`}
            </p>
          ) : null}
        </form>

        {message ? <p className="small muted">{message}</p> : null}
      </div>
      <DangerConfirmDialog
        open={Boolean(confirmDeleteId)}
        title="确认删除模型组"
        description={`删除「${deletingGroup?.name ?? "该组"}」(${deletingGroup?.baseUrl ?? ""})后,其模型将从工作台下拉移除。已生成的图片不受影响。`}
        confirmLabel="删除模型组"
        loadingLabel="删除中"
        loading={Boolean(deletingId)}
        error={deleteError}
        confirmIcon={<Trash2 size={16} />}
        onClose={() => {
          if (!deletingId) {
            setConfirmDeleteId(null);
            setDeleteError("");
          }
        }}
        onConfirm={() => {
          if (confirmDeleteId) void deleteGroup(confirmDeleteId);
        }}
      />
    </section>
  );
}
