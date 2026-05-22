"use client";

import { KeyRound, Save, ShieldCheck, UserX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { User } from "@/lib/types";

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
    </section>
  );
}
