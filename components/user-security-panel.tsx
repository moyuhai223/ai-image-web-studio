"use client";

import { Gauge, KeyRound, Save, ShieldCheck, Trash2, UserX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { User } from "@/lib/types";
import { DangerConfirmDialog } from "./danger-confirm-dialog";

export function UserSecurityPanel({
  users,
  currentUserId,
  dailyLimit
}: {
  users: User[];
  currentUserId: string;
  dailyLimit: number;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");
  const [limitInput, setLimitInput] = useState(String(dailyLimit));
  const [limitSaving, setLimitSaving] = useState(false);
  const [limitMessage, setLimitMessage] = useState("");
  const [limitError, setLimitError] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  // 默认保留图片、转给当前管理员接管(较不破坏);可切换为一并删除。
  const [transferImages, setTransferImages] = useState(true);

  async function saveDailyLimit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const num = Number(limitInput.trim());
    if (!Number.isInteger(num) || num < 0) {
      setLimitError(true);
      setLimitMessage("请输入不小于 0 的整数(0 = 不限)");
      return;
    }
    setLimitSaving(true);
    setLimitMessage("");
    setLimitError(false);
    try {
      const response = await fetch("/api/settings/usage-limits", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dailyGenerationLimit: num })
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        setLimitInput(String(data.dailyGenerationLimit ?? num));
        setLimitMessage(num > 0 ? `已保存:每人每日 ${data.dailyGenerationLimit ?? num} 次` : "已保存:不限次数");
        router.refresh();
      } else {
        setLimitError(true);
        setLimitMessage(data.error ?? "保存失败");
      }
    } catch {
      setLimitError(true);
      setLimitMessage("网络错误,请重试");
    } finally {
      setLimitSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError("");
    const response = await fetch(`/api/users/${deleteTarget.id}?transferImages=${transferImages}`, { method: "DELETE" });
    const data = await response.json().catch(() => ({}));
    setDeleting(false);
    if (response.ok) {
      setMessage(
        transferImages
          ? `已删除用户 ${deleteTarget.username},其图片(${data.transferredJobs ?? 0} 组)已转给你管理`
          : `已删除用户 ${deleteTarget.username}(清理 ${data.filesRemoved ?? 0}/${data.filesTotal ?? 0} 个文件)`
      );
      setDeleteTarget(null);
      router.refresh();
    } else {
      setDeleteError(data.error ?? "删除失败");
    }
  }

  async function updateUser(userId: string, body: Record<string, unknown>) {
    setBusyId(userId);
    setMessage("");
    const response = await fetch(`/api/users/${userId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    setBusyId("");
    setMessage(response.ok ? "用户安全设置已更新" : data.error ?? "更新失败");
    if (response.ok) router.refresh();
    return response.ok;
  }

  async function resetPassword(event: React.FormEvent<HTMLFormElement>, userId: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const ok = await updateUser(userId, {
      action: "resetPassword",
      password: form.get("password")
    });
    if (ok) event.currentTarget.reset();
  }

  async function setRole(event: React.FormEvent<HTMLFormElement>, userId: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await updateUser(userId, {
      action: "setRole",
      role: form.get("role")
    });
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="small muted" style={{ margin: "0 0 4px" }}>用户安全</p>
          <h2 className="panel-title">账号管理</h2>
        </div>
        <span className="status">每日生成上限: {dailyLimit > 0 ? `${dailyLimit} 次/人` : "不限"}</span>
      </div>
      <div className="panel-body form-stack">
        <form className="inline-user-form user-security-action-row" onSubmit={saveDailyLimit}>
          <label className="small muted" htmlFor="daily-generation-limit" style={{ whiteSpace: "nowrap" }}>
            <Gauge size={13} style={{ verticalAlign: "-2px" }} /> 每人每日生成上限
          </label>
          <input
            className="input"
            id="daily-generation-limit"
            name="dailyGenerationLimit"
            type="number"
            min={0}
            max={100000}
            step={1}
            value={limitInput}
            onChange={(event) => setLimitInput(event.target.value)}
            style={{ maxWidth: 120 }}
            disabled={limitSaving}
            required
          />
          <button className="status action-button action-save" type="submit" disabled={limitSaving}>
            <Save size={13} />
            {limitSaving ? "保存中" : "保存"}
          </button>
          <span className="small muted">0 = 不限;对所有用户生效,含高清化任务</span>
        </form>
        {limitMessage ? (
          <p className={limitError ? "small form-error" : "small muted"} role={limitError ? "alert" : undefined}>
            {limitMessage}
          </p>
        ) : null}
        {message ? <p className="small muted">{message}</p> : null}
        <div className="user-security-list">
          {users.map((item) => (
            <article className="user-security-card" key={item.id}>
              <div className="user-security-head">
                <div>
                  <strong>{item.username}</strong>
                  <p className="small muted">
                    {item.role === "admin" ? "管理员" : "成员"} · {item.active ? "启用" : "停用"}
                    {item.id === currentUserId ? " · 当前账号" : ""}
                  </p>
                </div>
              </div>

              <div className="user-security-actions">
                <div className="user-security-action-row">
                  <span className={`status ${item.active ? "succeeded" : "failed"}`}>{item.active ? "active" : "disabled"}</span>
                  <button
                    className={`status action-button ${item.active ? "action-disable" : "action-enable"}`}
                    type="button"
                    disabled={busyId === item.id || item.id === currentUserId}
                    onClick={() => updateUser(item.id, { action: "setActive", active: !item.active })}
                  >
                    <UserX size={13} />
                    {item.active ? "停用" : "启用"}
                  </button>
                  <button
                    className="status action-button action-danger"
                    type="button"
                    disabled={busyId === item.id || item.id === currentUserId}
                    onClick={() => {
                      setDeleteError("");
                      setTransferImages(true);
                      setDeleteTarget(item);
                    }}
                    title={item.id === currentUserId ? "不能删除当前账号" : "删除用户"}
                  >
                    <Trash2 size={13} />
                    删除
                  </button>
                </div>

                <form className="inline-user-form user-security-action-row" onSubmit={(event) => setRole(event, item.id)}>
                  <select className="select" name="role" defaultValue={item.role} disabled={busyId === item.id}>
                    <option value="member">成员</option>
                    <option value="admin">管理员</option>
                  </select>
                  <button className="status action-button action-save" type="submit" disabled={busyId === item.id}>
                    <ShieldCheck size={13} />
                    保存角色
                  </button>
                </form>

                <form className="inline-user-form password-reset-form user-security-action-row" onSubmit={(event) => resetPassword(event, item.id)}>
                  <input className="input" name="password" type="password" minLength={8} maxLength={128} placeholder="新密码" required />
                  <button className="status action-button action-save" type="submit" disabled={busyId === item.id}>
                    <KeyRound size={13} />
                    重置密码
                  </button>
                </form>
              </div>
            </article>
          ))}
        </div>
        <p className="small muted">
          <Save size={13} style={{ verticalAlign: "-2px" }} /> 登录失败 5 次后会限制 15 分钟；密码使用 scrypt 加盐哈希保存，不明文存储。
        </p>
      </div>

      <DangerConfirmDialog
        open={Boolean(deleteTarget)}
        title="确认删除用户"
        description={
          deleteTarget ? `将永久删除用户「${deleteTarget.username}」(不可恢复)。审计日志会保留。` : ""
        }
        confirmLabel="永久删除"
        loadingLabel="删除中"
        loading={deleting}
        error={deleteError}
        icon={<Trash2 size={20} />}
        onClose={() => {
          if (!deleting) {
            setDeleteTarget(null);
            setDeleteError("");
          }
        }}
        onConfirm={confirmDelete}
      >
        <fieldset className="user-delete-options" disabled={deleting}>
          <label className="user-delete-option">
            <input
              type="radio"
              name="deleteImages"
              checked={transferImages}
              onChange={() => setTransferImages(true)}
            />
            <span>
              <strong>保留图片,转给我管理</strong>
              <span className="small muted">该用户的生成记录/图片/参考图转到你名下,出现在你的记录页。</span>
            </span>
          </label>
          <label className="user-delete-option">
            <input
              type="radio"
              name="deleteImages"
              checked={!transferImages}
              onChange={() => setTransferImages(false)}
            />
            <span>
              <strong>一并删除图片</strong>
              <span className="small muted">连同其全部生成记录、图片、参考图、收藏及磁盘文件永久删除。</span>
            </span>
          </label>
        </fieldset>
      </DangerConfirmDialog>
    </section>
  );
}
