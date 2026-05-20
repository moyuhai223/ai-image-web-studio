"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";

export function CreateUserForm() {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: form.get("username"),
        password: form.get("password"),
        role: form.get("role")
      })
    });
    const data = await response.json().catch(() => ({}));
    setLoading(false);
    setMessage(response.ok ? "用户已保存" : data.error ?? "保存失败");
    if (response.ok) {
      event.currentTarget.reset();
      router.refresh();
    }
  }

  return (
    <form className="panel" onSubmit={submit}>
      <div className="panel-header">
        <h2 className="panel-title">新增或重置用户</h2>
      </div>
      <div className="panel-body form-stack">
        <div className="field">
          <label htmlFor="new-username">用户名</label>
          <input className="input" id="new-username" name="username" required />
        </div>
        <div className="field">
          <label htmlFor="new-password">密码</label>
          <input className="input" id="new-password" name="password" type="password" minLength={8} required />
        </div>
        <div className="field">
          <label htmlFor="new-role">角色</label>
          <select className="select" id="new-role" name="role" defaultValue="member">
            <option value="member">成员</option>
            <option value="admin">管理员</option>
          </select>
        </div>
        {message ? <p className="small muted">{message}</p> : null}
        <button className="button" type="submit" disabled={loading}>
          <UserPlus size={17} />
          {loading ? "保存中" : "保存用户"}
        </button>
      </div>
    </form>
  );
}
