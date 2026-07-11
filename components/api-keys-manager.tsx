"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import type { ApiKeySummary } from "@/lib/api-keys";
import { DangerConfirmDialog } from "./danger-confirm-dialog";
import { formatDateTime } from "@/lib/time";

type Props = {
  initialKeys: ApiKeySummary[];
  isAdmin: boolean;
};

/**
 * 每用户自助 API Key 管理:创建(明文只显示一次)、吊销、列表。
 * admin 视图带 username 列(看全站所有 Key)。
 */
export function ApiKeysManager({ initialKeys, isAdmin }: Props) {
  const router = useRouter();
  const [keys, setKeys] = useState<ApiKeySummary[]>(initialKeys);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");
  const [messageIsError, setMessageIsError] = useState(false);
  // 新建成功后的一次性明文展示
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<ApiKeySummary | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState("");

  async function refresh() {
    try {
      const response = await fetch("/api/user/api-keys");
      if (!response.ok) return;
      const data = (await response.json()) as { keys?: ApiKeySummary[] };
      if (Array.isArray(data.keys)) setKeys(data.keys);
    } catch {
      // 静默,保持现有列表
    }
  }

  async function createKey(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setMessage("");
    setMessageIsError(false);
    try {
      const response = await fetch("/api/user/api-keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name })
      });
      const data = (await response.json().catch(() => ({}))) as { key?: string; error?: string };
      if (!response.ok || !data.key) {
        setMessageIsError(true);
        setMessage(data.error ?? "创建失败");
        return;
      }
      setCreatedKey(data.key);
      setCopied(false);
      setName("");
      await refresh();
      router.refresh();
    } catch {
      setMessageIsError(true);
      setMessage("网络错误,请重试");
    } finally {
      setCreating(false);
    }
  }

  async function copyCreatedKey() {
    if (!createdKey) return;
    try {
      await navigator.clipboard.writeText(createdKey);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  async function confirmRevoke() {
    if (!revokeTarget) return;
    setRevoking(true);
    setRevokeError("");
    try {
      const response = await fetch("/api/user/api-keys", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: revokeTarget.id })
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setRevokeError(data.error ?? "吊销失败");
        return;
      }
      setRevokeTarget(null);
      setMessage("Key 已吊销,使用该 Key 的请求将立即失效");
      setMessageIsError(false);
      await refresh();
      router.refresh();
    } catch {
      setRevokeError("网络错误,请重试");
    } finally {
      setRevoking(false);
    }
  }

  const activeKeys = keys.filter((k) => !k.revoked_at);
  const revokedKeys = keys.filter((k) => k.revoked_at);

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 className="panel-title">
          <KeyRound size={17} /> API Key
        </h2>
        <span className="status">{activeKeys.length} 个有效</span>
      </div>
      <div className="panel-body form-stack">
        <p className="small muted">
          用 API Key 以 OpenAI 兼容格式调用本站生图:Base URL 填本站地址,端点 <code>POST /v1/images/generations</code>
          (请求头 <code>Authorization: Bearer sk-aiws-…</code>);模型列表 <code>GET /v1/models</code>。
          生成记录与每日配额计入你的账号。
        </p>

        {/* 新建 */}
        <form className="inline-user-form user-security-action-row" onSubmit={createKey}>
          <input
            className="input"
            placeholder="Key 名称(可选,如:n8n 工作流)"
            value={name}
            maxLength={40}
            onChange={(event) => setName(event.target.value)}
            disabled={creating}
            style={{ maxWidth: 260 }}
          />
          <button className="button action-button action-add" type="submit" disabled={creating}>
            <Plus size={15} /> {creating ? "创建中" : "创建 Key"}
          </button>
        </form>
        {message ? (
          <p className={messageIsError ? "small form-error" : "small muted"} role={messageIsError ? "alert" : undefined}>
            {message}
          </p>
        ) : null}

        {/* 一次性明文展示 */}
        {createdKey ? (
          <div className="panel" style={{ padding: 14 }}>
            <p className="small" style={{ margin: "0 0 8px" }}>
              <strong>新 Key 已创建——只显示这一次,关闭后无法再次查看,请立即复制保存:</strong>
            </p>
            <div className="actions" style={{ alignItems: "center", gap: 8 }}>
              <code style={{ wordBreak: "break-all", userSelect: "all" }}>{createdKey}</code>
              <button className="status action-button action-save" type="button" onClick={copyCreatedKey}>
                {copied ? <Check size={13} /> : <Copy size={13} />}
                {copied ? "已复制" : "复制"}
              </button>
              <button className="status action-button action-neutral" type="button" onClick={() => setCreatedKey(null)}>
                我已保存,关闭
              </button>
            </div>
          </div>
        ) : null}

        {/* 有效 Key 列表 */}
        {activeKeys.length > 0 ? (
          <div className="key-list">
            {activeKeys.map((item) => (
              <div className="key-row" key={item.id}>
                <div className="key-meta">
                  <div className="actions">
                    <strong>{item.name || "未命名"}</strong>
                    {isAdmin && item.username ? <span className="status">{item.username}</span> : null}
                  </div>
                  <span className="small muted key-preview">{item.key_prefix}…</span>
                  <span className="small muted">
                    创建于 {formatDateTime(item.created_at)} · {item.last_used_at ? `最近使用 ${formatDateTime(item.last_used_at)}` : "从未使用"}
                  </span>
                </div>
                <div className="key-actions">
                  <button
                    className="button action-button action-danger"
                    type="button"
                    onClick={() => {
                      setRevokeError("");
                      setRevokeTarget(item);
                    }}
                  >
                    <Trash2 size={15} /> 吊销
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="small muted">还没有 API Key。创建一个即可从外部程序调用本站生图。</p>
        )}

        {/* 已吊销(仅计数,不展开) */}
        {revokedKeys.length > 0 ? <p className="small muted">另有 {revokedKeys.length} 个已吊销的 Key(保留审计)。</p> : null}
      </div>

      <DangerConfirmDialog
        open={Boolean(revokeTarget)}
        title="确认吊销 API Key"
        description={`吊销「${revokeTarget?.name || revokeTarget?.key_prefix || "该 Key"}」后,使用它的请求将立即返回 401,且不可恢复。`}
        confirmLabel="吊销"
        loadingLabel="吊销中"
        loading={revoking}
        error={revokeError}
        icon={<Trash2 size={20} />}
        confirmIcon={<Trash2 size={16} />}
        onClose={() => {
          if (!revoking) {
            setRevokeTarget(null);
            setRevokeError("");
          }
        }}
        onConfirm={confirmRevoke}
      />
    </section>
  );
}
