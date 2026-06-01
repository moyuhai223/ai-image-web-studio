"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";

export function ChangePasswordForm({ username }: { username: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const currentPassword = String(form.get("currentPassword") ?? "");
    const newPassword = String(form.get("newPassword") ?? "");
    const confirmPassword = String(form.get("confirmPassword") ?? "");

    if (newPassword.length < 8) {
      setError("新密码至少 8 位");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致");
      return;
    }
    if (newPassword === currentPassword) {
      setError("新密码不能与当前密码相同");
      return;
    }

    setLoading(true);
    const response = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword })
    });
    const data = await response.json().catch(() => ({}));
    setLoading(false);
    if (!response.ok) {
      setError(data.error ?? "修改失败");
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <form className="panel login-card" onSubmit={submit}>
      <div className="panel-header">
        <h1 className="panel-title">设置新密码</h1>
      </div>
      <div className="panel-body form-stack">
        <p className="small muted" style={{ margin: 0 }}>
          账号 <strong>{username}</strong> 正在使用默认密码,请先修改后再使用系统。
        </p>
        <div className="field">
          <label htmlFor="currentPassword">当前密码</label>
          <input
            className="input"
            id="currentPassword"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="newPassword">新密码(至少 8 位)</label>
          <input
            className="input"
            id="newPassword"
            name="newPassword"
            type="password"
            minLength={8}
            maxLength={128}
            autoComplete="new-password"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="confirmPassword">确认新密码</label>
          <input
            className="input"
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            minLength={8}
            maxLength={128}
            autoComplete="new-password"
            required
          />
        </div>
        {error ? <p className="small" style={{ color: "var(--danger)" }}>{error}</p> : null}
        <button className="button" type="submit" disabled={loading}>
          <KeyRound size={17} />
          {loading ? "提交中" : "保存新密码"}
        </button>
      </div>
    </form>
  );
}
