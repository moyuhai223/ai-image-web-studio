"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Save, Sparkles } from "lucide-react";
import type { PromptOptimizeSettings } from "@/lib/prompt-optimize-settings";

type Props = {
  settings: PromptOptimizeSettings;
  defaultSystemPrompt: string;
  defaultModel: string;
};

type ApiResponse = PromptOptimizeSettings & { error?: string };

export function PromptOptimizePanel({ settings, defaultSystemPrompt, defaultModel }: Props) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(settings.enabled);
  const [model, setModel] = useState(settings.model);
  const [systemPrompt, setSystemPrompt] = useState(settings.systemPrompt);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function save() {
    setLoading(true);
    setMessage("");
    const response = await fetch("/api/settings/prompt-optimize", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled, model, systemPrompt })
    });
    const data = (await response.json().catch(() => ({}))) as ApiResponse;
    setLoading(false);
    if (!response.ok) {
      setMessage(data.error ?? "保存失败");
      return;
    }
    setMessage("已保存");
    router.refresh();
  }

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
          在生成页的「画面描述」旁提供「✨ 优化」按钮:把用户输入的简短描述,用下面配置的文本模型改写成更利于出图的高质量提示词。
        </p>

        <label className="optimize-toggle">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          <span>启用提示词优化</span>
        </label>

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
          <p className="small muted">用于改写提示词的文本模型,需为当前 Provider 支持的模型(默认 {defaultModel})。</p>
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
          <button className="button action-button action-save" type="button" onClick={save} disabled={loading}>
            <Save size={16} />
            {loading ? "保存中" : "保存设置"}
          </button>
          <button
            className="status action-button action-neutral"
            type="button"
            onClick={() => setSystemPrompt(defaultSystemPrompt)}
            disabled={loading || systemPrompt === defaultSystemPrompt}
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
