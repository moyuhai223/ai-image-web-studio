"use client";

import { Gauge, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** 运行设置里的生成并发数编辑(1~32)。保存写 usage_limits,队列下一轮 drain 生效。 */
export function ConcurrencyForm({ concurrency }: { concurrency: number }) {
  const router = useRouter();
  const [value, setValue] = useState(String(concurrency));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const num = Number(value.trim());
    if (!Number.isInteger(num) || num < 1 || num > 32) {
      setError(true);
      setMessage("请输入 1~32 的整数");
      return;
    }
    setSaving(true);
    setMessage("");
    setError(false);
    try {
      const response = await fetch("/api/settings/usage-limits", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ maxGenerationConcurrency: num })
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        setValue(String(data.maxGenerationConcurrency ?? num));
        setMessage(`已保存:并发 ${data.maxGenerationConcurrency ?? num}(正在跑的任务不受影响,新任务按新并发调度)`);
        router.refresh();
      } else {
        setError(true);
        setMessage(data.error ?? "保存失败");
      }
    } catch {
      setError(true);
      setMessage("网络错误,请重试");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <form className="inline-user-form user-security-action-row" onSubmit={save}>
        <label className="small muted" htmlFor="generation-concurrency" style={{ whiteSpace: "nowrap" }}>
          <Gauge size={13} style={{ verticalAlign: "-2px" }} /> 生成并发数
        </label>
        <input
          className="input"
          id="generation-concurrency"
          name="maxGenerationConcurrency"
          type="number"
          min={1}
          max={32}
          step={1}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          style={{ maxWidth: 120 }}
          disabled={saving}
          required
        />
        <button className="status action-button action-save" type="submit" disabled={saving}>
          <Save size={13} />
          {saving ? "保存中" : "保存"}
        </button>
        <span className="small muted">同时进行的生成任务数(1~32);快速高清化并发闸共用此值;调到 16+ 建议同步上调 DB_POOL_MAX</span>
      </form>
      {message ? (
        <p className={error ? "small form-error" : "small muted"} role={error ? "alert" : undefined}>
          {message}
        </p>
      ) : null}
    </>
  );
}
