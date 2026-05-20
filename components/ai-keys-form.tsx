"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, PauseCircle, PlayCircle, Plus, Trash2 } from "lucide-react";
import type { AiKeySummary } from "@/lib/api-keys";
import { formatDateTime } from "@/lib/time";
import { DangerConfirmDialog } from "./danger-confirm-dialog";

type Props = {
  keys: AiKeySummary[];
  hasEnvFallback: boolean;
  autoDisableEnabled: boolean;
  autoDisableFailureThreshold: number;
};

type ApiResponse = {
  error?: string;
};

function formatCreatedAt(value: string) {
  return formatDateTime(value);
}

function formatOptionalDate(value: string | null) {
  return value ? formatCreatedAt(value) : "从未";
}

export function AiKeysForm({ keys, hasEnvFallback, autoDisableEnabled, autoDisableFailureThreshold }: Props) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [policyLoading, setPolicyLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [policyEnabled, setPolicyEnabled] = useState(autoDisableEnabled);
  const [failureThreshold, setFailureThreshold] = useState(String(autoDisableFailureThreshold));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setLoading(true);
    setMessage("");

    const response = await fetch("/api/settings/ai-keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        label: formData.get("label"),
        apiKey: formData.get("apiKey")
      })
    });
    const data = (await response.json().catch(() => ({}))) as ApiResponse;
    setLoading(false);
    setMessage(response.ok ? "Key 已保存" : data.error ?? "保存失败");
    if (response.ok) {
      form.reset();
      router.refresh();
    }
  }

  async function removeKey(id: string) {
    setDeleteError("");
    setDeletingId(id);
    setMessage("");
    const response = await fetch("/api/settings/ai-keys", {
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
    setMessage("Key 已删除");
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

  async function toggleKey(id: string, enabled: boolean) {
    setTogglingId(id);
    setMessage("");
    const response = await fetch("/api/settings/ai-keys", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, enabled })
    });
    const data = (await response.json().catch(() => ({}))) as ApiResponse;
    setTogglingId(null);
    setMessage(response.ok ? (enabled ? "Key 已启用" : "Key 已停用") : data.error ?? "更新失败");
    if (response.ok) router.refresh();
  }

  async function saveFailurePolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const threshold = Math.min(20, Math.max(1, Math.trunc(Number(failureThreshold) || 3)));
    setPolicyLoading(true);
    setMessage("");
    const response = await fetch("/api/settings/ai-keys", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "failure-policy",
        autoDisableEnabled: policyEnabled,
        autoDisableFailureThreshold: threshold
      })
    });
    const data = (await response.json().catch(() => ({}))) as ApiResponse;
    setPolicyLoading(false);
    setFailureThreshold(String(threshold));
    setMessage(response.ok ? "失败策略已保存" : data.error ?? "保存失败策略失败");
    if (response.ok) router.refresh();
  }

  const enabledCount = keys.filter((item) => item.enabled).length;
  const deletingKey = keys.find((item) => item.id === confirmDeleteId);

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 className="panel-title">
          <KeyRound size={17} /> AI Key 轮询
        </h2>
        <span className="status">
          {keys.length > 0 ? `${enabledCount}/${keys.length} 启用` : hasEnvFallback ? "环境变量备用" : "未配置"}
        </span>
      </div>
      <div className="panel-body form-stack">
        <form className="form-stack" onSubmit={saveFailurePolicy}>
          <div className="field">
            <label htmlFor="ai-key-auto-disable">失败策略</label>
            <div className="template-picker">
              <label className="status" htmlFor="ai-key-auto-disable">
                <input
                  id="ai-key-auto-disable"
                  type="checkbox"
                  checked={policyEnabled}
                  onChange={(event) => setPolicyEnabled(event.target.checked)}
                />
                自动停用失败 Key
              </label>
              <input
                className="input"
                name="failureThreshold"
                type="number"
                min={1}
                max={20}
                value={failureThreshold}
                onChange={(event) => setFailureThreshold(event.target.value)}
                aria-label="连续失败次数"
              />
              <button className="status" type="submit" disabled={policyLoading}>
                {policyLoading ? "保存中" : "保存策略"}
              </button>
            </div>
            <p className="small muted">
              {policyEnabled ? `连续失败 ${failureThreshold || autoDisableFailureThreshold} 次后自动停用该 Key。` : "关闭后只记录失败次数，不会自动停用 Key。"}
            </p>
          </div>
        </form>

        <form className="form-stack" onSubmit={submit}>
          <div className="field">
            <label htmlFor="ai-key-label">名称</label>
            <input className="input" id="ai-key-label" name="label" maxLength={64} placeholder="主 Key" />
          </div>
          <div className="field">
            <label htmlFor="ai-key-value">AI Key</label>
            <input className="input" id="ai-key-value" name="apiKey" type="password" autoComplete="off" required />
          </div>
          <button className="button" type="submit" disabled={loading}>
            <Plus size={17} />
            {loading ? "保存中" : "添加 Key"}
          </button>
        </form>

        {message ? <p className="small muted">{message}</p> : null}

        {keys.length > 0 ? (
          <div className="key-list">
            {keys.map((item) => (
              <div className={`key-row ${item.enabled ? "" : "disabled"}`} key={item.id}>
                <div className="key-meta">
                  <div className="actions">
                    <strong>{item.label}</strong>
                    <span className={`status ${item.enabled ? "succeeded" : "failed"}`}>
                      {item.enabled ? "启用" : "停用"}
                    </span>
                  </div>
                  <span className="small muted key-preview">{item.preview}</span>
                  <div className="key-health">
                    <span className="small muted">成功 {item.successCount}</span>
                    <span className="small muted">失败 {item.failureCount}</span>
                    <span className="small muted">连续失败 {item.consecutiveFailures}</span>
                    <span className="small muted">最近使用 {formatOptionalDate(item.lastUsedAt)}</span>
                    <span className="small muted">最近成功 {formatOptionalDate(item.lastSucceededAt)}</span>
                    <span className="small muted">最近失败 {formatOptionalDate(item.lastFailedAt)}</span>
                    <span className="small muted">创建 {formatCreatedAt(item.createdAt)}</span>
                  </div>
                  {item.disabledReason ? <p className="small key-warning">{item.disabledReason}</p> : null}
                </div>
                <div className="key-actions">
                  <button
                    className="button secondary"
                    type="button"
                    disabled={togglingId === item.id}
                    onClick={() => toggleKey(item.id, !item.enabled)}
                  >
                    {item.enabled ? <PauseCircle size={16} /> : <PlayCircle size={16} />}
                    {togglingId === item.id ? "更新中" : item.enabled ? "停用" : "启用"}
                  </button>
                  <button
                    className="button danger"
                    type="button"
                    disabled={deletingId === item.id}
                    onClick={() => openDeleteConfirm(item.id)}
                  >
                    <Trash2 size={16} />
                    {deletingId === item.id ? "删除中" : "删除"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <DangerConfirmDialog
        open={Boolean(confirmDeleteId)}
        title="确认删除 AI Key"
        description={`会删除 ${deletingKey?.label ?? "这个 Key"}（${deletingKey?.preview ?? "当前 Key"}），删除后不可恢复。`}
        confirmLabel="删除 Key"
        loadingLabel="删除中"
        loading={Boolean(deletingId)}
        error={deleteError}
        confirmIcon={<Trash2 size={16} />}
        onClose={closeDeleteConfirm}
        onConfirm={() => {
          if (confirmDeleteId) void removeKey(confirmDeleteId);
        }}
      />
    </section>
  );
}
