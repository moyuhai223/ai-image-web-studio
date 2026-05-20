"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { LinkIcon, Save } from "lucide-react";

type Props = {
  aiBaseUrl: string;
  source: "database" | "env";
};

type ApiResponse = {
  aiBaseUrl?: string;
  error?: string;
};

export function ProviderSettingsForm({ aiBaseUrl, source }: Props) {
  const router = useRouter();
  const [value, setValue] = useState(aiBaseUrl);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");

    const response = await fetch("/api/settings/provider", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ aiBaseUrl: value })
    });
    const data = (await response.json().catch(() => ({}))) as ApiResponse;
    setLoading(false);

    if (!response.ok) {
      setMessage(data.error ?? "保存失败");
      return;
    }

    if (data.aiBaseUrl) setValue(data.aiBaseUrl);
    setMessage("Provider Base URL 已保存，新生成任务会直接使用");
    router.refresh();
  }

  return (
    <form className="form-stack" onSubmit={submit}>
      <div className="field">
        <label htmlFor="provider-base-url">
          <LinkIcon size={15} /> Provider Base URL
        </label>
        <div className="template-picker">
          <input
            className="input"
            id="provider-base-url"
            name="aiBaseUrl"
            type="url"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="https://ai.zh.ci"
            required
          />
          <button className="button secondary" type="submit" disabled={loading}>
            <Save size={16} />
            {loading ? "保存中" : "保存"}
          </button>
        </div>
        <p className="small muted">
          当前来源：{source === "database" ? "设置页保存" : ".env 默认值"}。保存后无需重新构建，新任务立即使用。
        </p>
        {message ? <p className="small muted">{message}</p> : null}
      </div>
    </form>
  );
}
