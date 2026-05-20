"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogIn } from "lucide-react";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: form.get("username"),
        password: form.get("password")
      })
    });
    const data = await response.json().catch(() => ({}));
    setLoading(false);
    if (!response.ok) {
      setError(data.error ?? "登录失败");
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <form className="panel login-card" onSubmit={submit}>
      <div className="panel-header">
        <h1 className="panel-title">登录 AI Image Studio</h1>
      </div>
      <div className="panel-body form-stack">
        <div className="field">
          <label htmlFor="username">用户名</label>
          <input className="input" id="username" name="username" autoComplete="username" required />
        </div>
        <div className="field">
          <label htmlFor="password">密码</label>
          <input className="input" id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
        {error ? <p className="small" style={{ color: "var(--danger)" }}>{error}</p> : null}
        <button className="button" type="submit" disabled={loading}>
          <LogIn size={17} />
          {loading ? "登录中" : "登录"}
        </button>
      </div>
    </form>
  );
}
