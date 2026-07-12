"use client";

import { Check, Play, Sparkles, Undo2, X } from "lucide-react";
import { ButtonSpinner } from "../button-spinner";
import { useStudio } from "./studio-provider";

/**
 * 底部 Prompt Composer:模板/最近提示词/优化工具行 + 提示词输入 + 参数摘要胶囊 + [开始生成]。
 * 优化对比卡以浮层出现在 Composer 上方(.composer-float)。
 * 提交仍是 <form onSubmit>(保留 textarea required 原生校验与 Ctrl+Enter 语义),
 * 但 FormData 由 provider 受控构造,不再从 DOM 收集。
 */
export function PromptComposer() {
  const studio = useStudio();
  const {
    prompt,
    setPrompt,
    promptTextareaRef,
    handlePromptKeyDown,
    promptTemplates,
    selectedTemplateId,
    setSelectedTemplateId,
    applyPromptTemplate,
    recentPrompts,
    selectedRecentIndex,
    setSelectedRecentIndex,
    applyRecentPrompt,
    promptOptimizeEnabled,
    optimizing,
    optimizeError,
    optimizeUndo,
    optimizeResult,
    optimizePrompt,
    applyOptimizeResult,
    discardOptimizeResult,
    undoOptimize,
    loading,
    error,
    model,
    modelLabel,
    size,
    count,
    referenceSummary,
    submit
  } = studio;

  return (
    <div className="studio-composer">
      {optimizeResult ? (
        <div className="optimize-compare composer-float">
          <div className="optimize-compare-head">
            <Sparkles size={13} />
            <span>优化建议 — 对比后再决定</span>
          </div>
          <div className="optimize-compare-grid">
            <div className="optimize-compare-col">
              <div className="optimize-compare-label">原文 · {optimizeResult.original.length} 字</div>
              <div className="optimize-compare-text">{optimizeResult.original}</div>
            </div>
            <div className="optimize-compare-col optimize-compare-col--new">
              <div className="optimize-compare-label">优化后 · {optimizeResult.optimized.length} 字</div>
              <div className="optimize-compare-text">{optimizeResult.optimized}</div>
            </div>
          </div>
          <div className="optimize-compare-actions">
            <button className="button action-button action-save" type="button" onClick={applyOptimizeResult}>
              <Check size={15} />
              采用优化版
            </button>
            <button className="status action-button action-neutral" type="button" onClick={discardOptimizeResult}>
              <X size={14} />
              放弃
            </button>
          </div>
        </div>
      ) : null}

      <form
        className="composer-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="composer-toolbar">
          {promptTemplates.length > 0 ? (
            <div className="template-picker composer-picker">
              <select
                className="select"
                id="prompt-template"
                aria-label="提示词模板"
                value={selectedTemplateId}
                onChange={(event) => setSelectedTemplateId(event.target.value)}
              >
                <option value="">选择模板</option>
                {promptTemplates.map((template) => (
                  <option key={template.id} value={template.id}>
                    [{template.category}] {template.title}
                  </option>
                ))}
              </select>
              <button className="status" type="button" onClick={() => applyPromptTemplate("replace")} disabled={!selectedTemplateId}>
                填入
              </button>
              <button className="status" type="button" onClick={() => applyPromptTemplate("append")} disabled={!selectedTemplateId}>
                追加
              </button>
            </div>
          ) : null}
          {recentPrompts.length > 0 ? (
            <div className="template-picker composer-picker">
              <select
                className="select"
                id="recent-prompt"
                aria-label="最近提示词"
                value={selectedRecentIndex}
                onChange={(event) => setSelectedRecentIndex(event.target.value)}
              >
                <option value="">最近提示词</option>
                {recentPrompts.map((text, index) => (
                  <option key={index} value={String(index)}>
                    {text.length > 48 ? `${text.slice(0, 48)}…` : text}
                  </option>
                ))}
              </select>
              <button className="status" type="button" onClick={() => applyRecentPrompt("replace")} disabled={!selectedRecentIndex}>
                填入
              </button>
              <button className="status" type="button" onClick={() => applyRecentPrompt("append")} disabled={!selectedRecentIndex}>
                追加
              </button>
            </div>
          ) : null}
          <div className="composer-toolbar-right">
            {promptOptimizeEnabled ? (
              <>
                <button
                  className="status prompt-optimize-button"
                  type="button"
                  onClick={() => void optimizePrompt()}
                  disabled={optimizing || !prompt.trim() || optimizeResult !== null}
                  title="用 AI 把当前描述改写成更利于出图的高质量提示词"
                >
                  <Sparkles size={13} />
                  {optimizing ? "优化中…" : "优化提示词"}
                </button>
                {optimizeUndo !== null && !optimizeResult ? (
                  <button className="status" type="button" onClick={undoOptimize} disabled={optimizing}>
                    <Undo2 size={13} />
                    撤销
                  </button>
                ) : null}
                {optimizeError ? <span className="small prompt-optimize-error">{optimizeError}</span> : null}
              </>
            ) : null}
            <span className="small muted composer-charcount">{prompt.trim().length} 字</span>
          </div>
        </div>

        {error ? <p className="small form-error composer-error" role="alert">{error}</p> : null}

        <div className="composer-main">
          <textarea
            ref={promptTextareaRef}
            className="textarea composer-textarea"
            id="prompt"
            name="prompt"
            rows={2}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={handlePromptKeyDown}
            placeholder="描述你要生成的画面、风格、主体、构图和细节"
            required
          />
          <div className="composer-side">
            <div className="generation-summary-bar composer-summary" aria-label="生成参数确认">
              <span>{modelLabel}</span>
              <span>{size}</span>
              <span>{count} 张</span>
              <span>{referenceSummary}</span>
            </div>
            <button className="button composer-submit" type="submit" disabled={loading || !model} aria-busy={loading}>
              {loading ? <ButtonSpinner size={17} /> : <Play size={17} />}
              {loading ? "生成中" : "开始生成"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
