"use client";

import { ImagePlus } from "lucide-react";
import { JobControlButton } from "../job-control-button";
import { generationStatusLabel } from "@/lib/generation-status";
import { formatPhaseTimings, progressTailLeft } from "./studio-model";
import { ImageCard } from "./image-card";
import { useStudio } from "./studio-provider";

/**
 * 中栏画布:结果预览(绝对视觉中心)+ 任务队列面板(V1 暂留,V2 移入全局任务中心)。
 */
export function CanvasPanel() {
  const studio = useStudio();
  const {
    activeImages,
    activeLightboxItems,
    activeSummary,
    activePhaseTimingsText,
    loading,
    editFromImage,
    queue,
    queueLoading,
    loadQueueStatus,
    refreshJobLists
  } = studio;

  return (
    <div className="studio-canvas-stack">
      <section className="panel studio-panel studio-canvas">
        <div className="panel-header">
          <h2 className="panel-title">画布</h2>
          {activeSummary ? <span className={`status ${activeSummary.status}`}>{activeSummary.label}</span> : null}
        </div>
        <div className="panel-body studio-panel-body">
          {activeImages.length > 0 ? (
            <div className="preview-stack">
              {activeSummary && !activeSummary.terminal ? (
                <div className="inline-progress batch-progress" aria-label="批量生成进度" aria-live="polite">
                  <div className="flow-track" aria-hidden="true">
                    <div className={`flow-bar ${activeSummary.status}`} style={{ width: `${activeSummary.percent}%` }} />
                    <div className="flow-tail" style={{ left: progressTailLeft(activeSummary.percent) }} />
                  </div>
                  <p className="small muted">{activeSummary.percent}% · 已保存 {activeSummary.saved} / {activeSummary.total} 张</p>
                  {activePhaseTimingsText ? (
                    <p className="small muted phase-timings">{activePhaseTimingsText}</p>
                  ) : null}
                </div>
              ) : null}
              <div className="preview-grid">
                {activeImages.map((image, index) => (
                  <ImageCard
                    key={image.id}
                    image={image}
                    galleryItems={activeLightboxItems}
                    galleryIndex={index}
                    onEdit={editFromImage}
                  />
                ))}
              </div>
            </div>
          ) : loading ? (
            <div className="empty-state preview-empty-state">
              <div className="preview-placeholder" aria-hidden="true">
                <span className="preview-placeholder-tile wide" />
                <span className="preview-placeholder-tile" />
                <span className="preview-placeholder-tile" />
              </div>
              <div className="preview-empty-copy">
                <ImagePlus size={34} />
                <p>{activeSummary?.message ?? "正在创建后台任务"}</p>
                {activeSummary ? (
                  <div className="inline-progress" aria-label="生成进度" aria-live="polite">
                    <div className="flow-track" aria-hidden="true">
                      <div className={`flow-bar ${activeSummary.status}`} style={{ width: `${activeSummary.percent}%` }} />
                      {!activeSummary.terminal ? <div className="flow-tail" style={{ left: progressTailLeft(activeSummary.percent) }} /> : null}
                    </div>
                    <p className="small muted">{activeSummary.percent}% · 已保存 {activeSummary.saved} / {activeSummary.total} 张</p>
                    {activePhaseTimingsText ? (
                      <p className="small muted phase-timings">{activePhaseTimingsText}</p>
                    ) : null}
                  </div>
                ) : (
                  null
                )}
              </div>
            </div>
          ) : (
            <div className="empty-state preview-empty-state">
              <div className="preview-placeholder" aria-hidden="true">
                <span className="preview-placeholder-tile wide" />
                <span className="preview-placeholder-tile" />
                <span className="preview-placeholder-tile" />
              </div>
              <div className="preview-empty-copy">
                <ImagePlus size={34} />
                <p>生成结果会出现在这里</p>
                <p className="small muted">填写提示词、选择参数后，新的图片会在这里铺开预览。</p>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="panel studio-panel">
        <div className="panel-header">
          <h2 className="panel-title">任务队列</h2>
          <div className="actions">
            <button className="status" type="button" onClick={() => loadQueueStatus()} disabled={queueLoading}>
              {queueLoading ? "刷新中" : "刷新"}
            </button>
          </div>
        </div>
        <div className="panel-body queue-list">
          <div className="queue-summary">
            <span className="status running">运行 <span className="num">{queue.running} / {queue.concurrency}</span></span>
            <span className="status queued">排队 <span className="num">{queue.queued}</span></span>
          </div>
          {queueLoading && queue.jobs.length === 0 ? <p className="muted small">正在加载任务队列...</p> : null}
          {!queueLoading && queue.jobs.length === 0 ? <p className="muted small">当前没有排队或运行中的任务。</p> : null}
          {queue.jobs.map((item) => (
            <article className="queue-item" key={item.id}>
              <div className="queue-item-head">
                <span className={`status ${item.status}`}>{generationStatusLabel(item.status)}</span>
                <span className="small muted">
                  {item.status === "queued" && item.queue_position ? <>队列 <span className="num">#{item.queue_position}</span></> : item.username ?? ""}
                </span>
              </div>
              <p className="small queue-prompt">{item.prompt.slice(0, 72)}</p>
              {item.progress ? (
                <>
                  <div className="flow-track queue-progress" aria-label="任务进度">
                    <div className={`flow-bar ${item.status}`} style={{ width: `${item.progress.percent}%` }} />
                    <div className="flow-tail" style={{ left: progressTailLeft(item.progress.percent) }} />
                  </div>
                  <p className="small muted">
                    <span className="num">{item.progress.percent}%</span> · 已保存 <span className="num">{item.progress.current} / {item.count}</span> 张
                  </p>
                  {(() => {
                    const text = formatPhaseTimings(item.progress.phaseTimings);
                    return text ? <p className="small muted phase-timings">{text}</p> : null;
                  })()}
                </>
              ) : (
                <p className="small muted"><span className="num">{item.count}</span> 张 · {item.model}</p>
              )}
              <div className="actions">
                <JobControlButton action="cancel" recordId={item.id} onDone={refreshJobLists} />
                <a className="status action-button action-detail" href={`/records/${item.id}`}>详情</a>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
