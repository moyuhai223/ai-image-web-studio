"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, RotateCcw, Save, Sparkles, Trash2 } from "lucide-react";
import type { PromptOptimizeSummary } from "@/lib/prompt-optimize-settings";

type Props = {
  settings: PromptOptimizeSummary;
  defaultSystemPrompt: string;
  defaultModel: string;
};

type ApiResponse = PromptOptimizeSummary & { error?: string };

export function PromptOptimizePanel({ settings, defaultSystemPrompt, defaultModel }: Props) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(settings.enabled);
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl);
  const [model, setModel] = useState(settings.model);
  const [systemPrompt, setSystemPrompt] = useState(settings.systemPrompt);
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [message, setMessage] = useState("");

  async function save() {
    setLoading(true);
    setMessage("");
    const response = await fetch("/api/settings/prompt-optimize", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        enabled,
        baseUrl,
        model,
        systemPrompt,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {})
      })
    });
    const data = (await response.json().catch(() => ({}))) as ApiResponse;
    setLoading(false);
    if (!response.ok) {
      setMessage(data.error ?? "保存失败");
      return;
    }
    setApiKey("");
    setMessage("已保存");
    router.refresh();
  }

  async function clearKey() {
    setClearing(true);
    setMessage("");
    const response = await fetch("/api/settings/prompt-optimize", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clearApiKey: true })
    });
    const data = (await response.json().catch(() => ({}))) as ApiResponse;
    setClearing(false);
    if (!response.ok) {
      setMessage(data.error ?? "清除失败");
      return;
    }
    setMessage("已清除 API Key");
    router.refresh();
  }

  const busy = loading || clearing;
  const missingKey = enabled && !settings.hasApiKey && !apiKey.trim();

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 className="panel-title">
          <Sparkles size={17} /> 提示词优化
        </h2>
        <span className="status">{enabled ? "已启用" : "已停用"}</span>
      </div>
      <div className="panel-body form-stack">
        <p className="small muted">
          在生成页「画面描述」旁提供「✨ 优化」按钮,用下面配置的<strong>独立</strong> URL / Key / 模型,把简短描述改写成更利于出图的高质量提示词。凭据与画图 Key
          池隔离,互不影响。
        </p>

        <label className="optimize-toggle">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          <span>启用提示词优化</span>
        </label>

        {missingKey ? (
          <p className="small prompt-optimize-error">已启用但未配置 API Key,前台暂不显示优化按钮——请在下方填写独立 Key。</p>
        ) : null}

        <div className="field">
          <label htmlFor="optimize-base-url">Base URL(可留空)</label>
          <input
            className="input"
            id="optimize-base-url"
            value={baseUrl}
            maxLength={300}
            placeholder="留空则用画图 Provider 的地址,如 https://ai.zh.ci"
            onChange={(event) => setBaseUrl(event.target.value)}
          />
          <p className="small muted">优化请求的接口地址。留空时回退使用画图默认 Provider 的 Base URL(同厂商)。</p>
        </div>

        <div className="field">
          <label htmlFor="optimize-api-key">独立 API Key</label>
          <input
            className="input"
            id="optimize-api-key"
            type="password"
            value={apiKey}
            autoComplete="off"
            maxLength={200}
            placeholder={settings.hasApiKey ? `已配置:${settings.apiKeyPreview ?? "****"}(留空=不修改)` : "粘贴用于优化的独立 Key"}
            onChange={(event) => setApiKey(event.target.value)}
          />
          <p className="small muted">
            <KeyRound size={12} /> 与画图 Key 隔离,单独存储(加密)。
            {settings.hasApiKey ? (
              <button
                className="status action-button action-danger prompt-optimize-clear"
                type="button"
                onClick={clearKey}
                disabled={busy}
              >
                <Trash2 size={12} />
                {clearing ? "清除中" : "清除 Key"}
              </button>
            ) : null}
          </p>
        </div>

        <div className="field">
          <label htmlFor="optimize-model">文本模型</label>
          <input
            className="input"
            id="optimize-model"
            value={model}
            maxLength={120}
            placeholder={defaultModel}
            onChange={(event) => setModel(event.target.value)}
          />
          <p className="small muted">用于改写提示词的文本模型,需为该 Base URL + Key 支持的模型(默认 {defaultModel})。</p>
        </div>

        <div className="field">
          <label htmlFor="optimize-system-prompt">预设提示词(System Prompt)</label>
          <textarea
            className="textarea"
            id="optimize-system-prompt"
            value={systemPrompt}
            maxLength={4000}
            rows={8}
            onChange={(event) => setSystemPrompt(event.target.value)}
          />
          <p className="small muted">优化器收到的系统指令,决定改写风格与边界。{systemPrompt.trim().length}/4000 字</p>
        </div>

        <div className="actions">
          <button className="button action-button action-save" type="button" onClick={save} disabled={busy}>
            <Save size={16} />
            {loading ? "保存中" : "保存设置"}
          </button>
          <button
            className="status action-button action-neutral"
            type="button"
            onClick={() => setSystemPrompt(defaultSystemPrompt)}
            disabled={busy || systemPrompt === defaultSystemPrompt}
          >
            <RotateCcw size={13} />
            恢复默认提示词
          </button>
        </div>

        {message ? <p className="small muted">{message}</p> : null}
      </div>
    </section>
  );
}
