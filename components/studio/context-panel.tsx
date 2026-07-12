"use client";

import { ArrowDown, ArrowUp, Brush, ChevronDown, ImagePlus, PanelRightClose, RefreshCcw, Sparkles, X } from "lucide-react";
import { CopyPromptButton } from "../copy-prompt-button";
import { DangerConfirmDialog } from "../danger-confirm-dialog";
import { DeleteRecordButton } from "../delete-record-button";
import { FavoriteImageButton } from "../favorite-image-button";
import { ImageWithSkeleton } from "../image-with-skeleton";
import { JobControlButton } from "../job-control-button";
import { MaskEditor } from "../mask-editor";
import { ReferenceBasketButton } from "../reference-basket";
import { generationStatusLabel, isRetryableGenerationStatus } from "@/lib/generation-status";
import { resolutionTier } from "@/lib/image-size";
import { imageThumbnailUrl, THUMBNAIL_QUERY } from "@/lib/thumbnails";
import { formatFileSize, referenceSourceLabel } from "./studio-model";
import { useStudio } from "./studio-provider";

/**
 * 右栏上下文面板 v0(V1 过渡态):参考图管理(上传/最近参考/已选栈/局部重绘)+ 最近记录。
 * V3 将升级为「参考图 | 图片」双 tab 上下文面板。
 */
export function ContextPanel({ onCollapse }: { onCollapse: () => void }) {
  const studio = useStudio();
  const {
    limits,
    referenceSummary,
    recentReferenceImages,
    selectedReferences,
    referencesOpen,
    setReferencesOpen,
    referenceFileInputRef,
    handleReferenceFileChange,
    toggleLibraryReference,
    removeSelectedReference,
    clearAllReferences,
    moveSelectedReference,
    maskOpen,
    setMaskOpen,
    maskBlob,
    setMaskBlob,
    maskPreviewUrl,
    primaryReferenceSrc,
    upscalingKey,
    upscaleConfirmKey,
    setUpscaleConfirmKey,
    upscaleError,
    setUpscaleError,
    upscaleReference,
    history,
    historyLoading,
    historyLoaded,
    loadRecentJobs,
    applyTaskParams,
    removeHistoryItem,
    refreshJobLists,
    loading
  } = studio;

  return (
    <div className="studio-context-stack">
      <section className="panel studio-panel">
        <div className="panel-header studio-ref-header">
          <button
            className="reference-section-toggle studio-ref-toggle"
            type="button"
            aria-expanded={referencesOpen}
            aria-controls="studio-reference-body"
            onClick={() => setReferencesOpen((current) => !current)}
          >
            <span className="panel-title">参考图</span>
            <span className="reference-section-toggle-meta">
              <span className="small muted">{referenceSummary}</span>
              <span className="status action-button action-neutral reference-section-toggle-status">
                <ChevronDown size={14} />
                {referencesOpen ? "收起" : "展开"}
              </span>
            </span>
          </button>
          <button className="status studio-collapse-btn" type="button" onClick={onCollapse} title="收起面板" aria-label="收起面板">
            <PanelRightClose size={15} />
          </button>
        </div>
        {referencesOpen ? (
        <div className="panel-body studio-panel-body" id="studio-reference-body">
          <div className="reference-picker">
            <label
              className={`reference-option upload-reference-option ${selectedReferences.some((reference) => reference.type === "upload") ? "selected" : ""}`}
              htmlFor="referenceImage"
            >
              <span className="reference-option-thumb reference-upload-thumb">
                <ImagePlus size={20} />
              </span>
              <span>上传参考</span>
              <small>PNG / JPG / WebP，可多选 · 支持 Ctrl+V 粘贴截图</small>
            </label>
            {recentReferenceImages.map((reference, index) => (
              <button
                key={reference.id}
                className={`reference-option reference-option-image${selectedReferences.some((item) => item.key === `library:${reference.id}`) ? " selected" : ""}`}
                type="button"
                onClick={() => toggleLibraryReference(reference)}
              >
                <img src={`/api/reference-images/${reference.id}?thumb=1`} alt="" />
                <span>{index === 0 ? "最近参考" : `参考 ${index + 1}`}</span>
                <small>{selectedReferences.some((item) => item.key === `library:${reference.id}`) ? "已选择" : formatFileSize(reference.byte_size)}</small>
              </button>
            ))}
          </div>
          <input
            ref={referenceFileInputRef}
            className="file-input"
            id="referenceImage"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            onChange={handleReferenceFileChange}
          />
          <div className="reference-selection-stack">
            {selectedReferences.length > 0 ? (
              <>
                {selectedReferences.map((reference, index) => (
                  <div
                    className={`reference-chip current-reference-chip ${reference.type === "upload" ? "upload-reference-chip" : ""}`}
                    key={reference.key}
                  >
                    {reference.imageSrc ? (
                      index === 0 && maskPreviewUrl ? (
                        <span className="reference-thumb-masked" title="已设置局部重绘,红色为涂抹区域">
                          <img src={reference.imageSrc} alt="" />
                          <img src={maskPreviewUrl} alt="" className="reference-thumb-mask-overlay" />
                        </span>
                      ) : (
                        <img src={reference.imageSrc} alt="" />
                      )
                    ) : (
                      <div className="reference-chip-icon">
                        <ImagePlus size={20} />
                      </div>
                    )}
                    <div>
                      <div className="reference-chip-title-row">
                        <strong>{index === 0 ? "主参考图" : `参考图 ${index + 1}`}</strong>
                        <span className="status">{referenceSourceLabel(reference.type)}</span>
                      </div>
                      <p className="small muted">{reference.title} · {reference.detail}</p>
                    </div>
                    <div className="reference-chip-actions">
                      <button className="status" type="button" disabled={index === 0} onClick={() => moveSelectedReference(reference.key, -1)}>
                        <ArrowUp size={13} />
                      </button>
                      <button
                        className="status"
                        type="button"
                        disabled={index === selectedReferences.length - 1}
                        onClick={() => moveSelectedReference(reference.key, 1)}
                      >
                        <ArrowDown size={13} />
                      </button>
                      <button
                        className="status action-button action-upscale"
                        type="button"
                        disabled={upscalingKey === reference.key}
                        onClick={() => {
                          setUpscaleError("");
                          setUpscaleConfirmKey(reference.key);
                        }}
                      >
                        <Sparkles size={13} />
                        {upscalingKey === reference.key ? "处理中…" : "高清化"}
                      </button>
                      <button className="status" type="button" onClick={() => removeSelectedReference(reference.key)}>
                        <X size={13} />
                        移除
                      </button>
                    </div>
                  </div>
                ))}
                <button className="status reference-clear-all" type="button" onClick={clearAllReferences}>
                  清空参考图
                </button>
                <div className="mask-controls-row">
                  <button
                    type="button"
                    className={`status mask-open-btn${maskBlob ? " mask-tool-active" : ""}`}
                    onClick={() => setMaskOpen(true)}
                    disabled={!primaryReferenceSrc}
                  >
                    <Brush size={13} />
                    {maskBlob ? "局部重绘已设置 · 重新涂抹" : "局部重绘"}
                  </button>
                  {maskBlob ? (
                    <button type="button" className="status" onClick={() => setMaskBlob(null)}>
                      <X size={13} /> 清除蒙版
                    </button>
                  ) : (
                    <span className="small muted">只想改局部(如只换裤子颜色)就涂抹该区域</span>
                  )}
                </div>
                {maskOpen && primaryReferenceSrc ? (
                  <MaskEditor
                    key={primaryReferenceSrc}
                    imageSrc={primaryReferenceSrc}
                    onChange={setMaskBlob}
                    onClose={() => setMaskOpen(false)}
                  />
                ) : null}
              </>
            ) : (
              <p className="small muted reference-empty-copy">未选择参考图。可上传多张、选择最近参考图，或在图片卡片点击“编辑”加入参考图。</p>
            )}
          </div>
        </div>
        ) : null}
      </section>

      <DangerConfirmDialog
        open={Boolean(upscaleConfirmKey)}
        title="确认高清化"
        description="将用 gpt-image-2 对这张参考图做 AI 高清重绘(请求原生 4K):会消耗一次生成额度,可能轻微改变画面;实际清晰度提升取决于模型返回。"
        confirmLabel="确认重绘"
        loadingLabel="提交中"
        loading={Boolean(upscalingKey)}
        error={upscaleError}
        icon={<Sparkles size={20} />}
        confirmIcon={<Sparkles size={16} />}
        onClose={() => {
          if (upscalingKey) return;
          setUpscaleConfirmKey("");
          setUpscaleError("");
        }}
        onConfirm={() => {
          const target = selectedReferences.find((item) => item.key === upscaleConfirmKey);
          if (target) void upscaleReference(target);
        }}
      />

      <section className="panel studio-panel">
        <div className="panel-header">
          <h2 className="panel-title">最近记录</h2>
          <div className="actions">
            <button className="status" type="button" onClick={() => loadRecentJobs()} disabled={historyLoading}>
              {historyLoading ? "加载中" : "加载"}
            </button>
            <a className="status" href="/records">全部</a>
          </div>
        </div>
        <div className="panel-body history-list">
          {historyLoading ? <p className="muted small">正在加载最近记录...</p> : null}
          {!historyLoading && !historyLoaded && history.length === 0 ? <p className="muted small">还没有加载最近记录。</p> : null}
          {!historyLoading && historyLoaded && history.length === 0 ? <p className="muted small">还没有生成记录。</p> : null}
          {history.map((recent) => {
            const resTier = resolutionTier(recent.thumbnail_width, recent.thumbnail_height);
            const resBadge = resTier ? <span className={`res-badge res-badge-${resTier === "4K" ? "4k" : "2k"}`}>{resTier}</span> : null;
            // 无输出图(失败/排队中)但是编辑/参考任务时,用「源图」缩略图 + 「编辑源」角标,方便看出编辑的是哪张。
            const refThumbUrl = recent.thumbnail_id
              ? null
              : recent.ref_source_image_id
                ? imageThumbnailUrl(recent.ref_source_image_id)
                : recent.ref_library_image_id
                  ? `/api/reference-images/${recent.ref_library_image_id}?${THUMBNAIL_QUERY}`
                  : null;
            const refBadge = refThumbUrl ? <span className="ref-badge">编辑源</span> : null;
            const recentThumb = recent.thumbnail_id ? (
              <ImageWithSkeleton className="thumb" wrapperClassName="thumb-skeleton" src={imageThumbnailUrl(recent.thumbnail_id)} alt="" />
            ) : refThumbUrl ? (
              <ImageWithSkeleton className="thumb" wrapperClassName="thumb-skeleton" src={refThumbUrl} alt="编辑源图" />
            ) : (
              <div className="thumb" />
            );
            return (
            <article className="history-item" key={recent.id}>
              {!recent.localOnly ? (
                <a className="thumb-link" href={`/records/${recent.id}`} aria-label="查看记录详情">
                  {recentThumb}
                  {resBadge}
                  {refBadge}
                </a>
              ) : (
                <div className="thumb-link">
                  {recentThumb}
                  {resBadge}
                  {refBadge}
                </div>
              )}
              <div className="history-content">
                <div className="history-status-row">
                  <div className={`status ${recent.status}`}>{generationStatusLabel(recent.status)}</div>
                  <span className="small muted history-meta">{recent.model} · {recent.username ?? ""}</span>
                  <CopyPromptButton prompt={recent.prompt} />
                </div>
                <p className="small history-prompt" title={recent.prompt}>{recent.prompt}</p>
                <div className="actions">
                  {recent.localOnly ? (
                    <span className={`status ${recent.status}`}>{generationStatusLabel(recent.status)}</span>
                  ) : null}
                  {!recent.localOnly && isRetryableGenerationStatus(recent.status) ? (
                    <JobControlButton action="requeue" recordId={recent.id} onDone={refreshJobLists} />
                  ) : null}
                  {!recent.localOnly && (recent.status === "queued" || recent.status === "running") ? (
                    <JobControlButton action="cancel" recordId={recent.id} onDone={refreshJobLists} />
                  ) : null}
                  {recent.thumbnail_id ? (
                    <ReferenceBasketButton imageId={recent.thumbnail_id} prompt={recent.prompt} />
                  ) : null}
                  {!recent.localOnly && recent.thumbnail_id ? (
                    <FavoriteImageButton imageId={recent.thumbnail_id} initialFavorite={recent.thumbnail_favorite ?? false} />
                  ) : null}
                  {!recent.localOnly && recent.status !== "queued" && recent.status !== "running" ? (
                    <DeleteRecordButton recordId={recent.id} onDeleted={() => removeHistoryItem(recent.id)} />
                  ) : null}
                  {recent.status === "succeeded" ? (
                    <button className="status action-button action-rerun" type="button" onClick={() => applyTaskParams(recent)} disabled={loading}>
                      <RefreshCcw size={13} />
                      重做
                    </button>
                  ) : null}
                </div>
              </div>
            </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
