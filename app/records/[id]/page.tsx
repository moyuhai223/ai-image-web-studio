import { notFound } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { CopyPromptButton } from "@/components/copy-prompt-button";
import { DeleteRecordButton } from "@/components/delete-record-button";
import { FavoriteImageButton } from "@/components/favorite-image-button";
import { ImageWithSkeleton } from "@/components/image-with-skeleton";
import { ImageLightbox, type LightboxItem } from "@/components/image-lightbox";
import { ImageTagsEditor } from "@/components/image-tags-editor";
import { JobAutoRefresh } from "@/components/job-auto-refresh";
import { JobControlButton } from "@/components/job-control-button";
import { ReferenceBasketButton } from "@/components/reference-basket";
import { RerunButton } from "@/components/rerun-button";
import { requireUser } from "@/lib/auth";
import { generationStatusLabel, isRetryableGenerationStatus, isTerminalGenerationStatus } from "@/lib/generation-status";
import { getJobById, listImageVersionChainForJob } from "@/lib/repository";
import { formatDateTime } from "@/lib/time";
import { imageThumbnailUrl } from "@/lib/thumbnails";
import { getUiThemePreference } from "@/lib/ui-theme";
import type { GeneratedImage, ImageVersionNode, JobWithImages } from "@/lib/types";
import { Download, Pencil } from "lucide-react";

export const dynamic = "force-dynamic";

type FlowStep = {
  title: string;
  detail: string;
  state: "done" | "active" | "pending" | "failed" | "canceled";
};

function getProgressPercent(job: JobWithImages) {
  if (job.progress) return job.progress.percent;
  const savedCount = job.images.length;
  if (job.status === "succeeded") return 100;
  if (job.status === "failed" || job.status === "upstream_error") return savedCount > 0 ? 80 : 45;
  if (job.status === "interrupted") return savedCount > 0 ? 80 : 35;
  if (job.status === "canceled") return 0;
  if (job.status === "queued") return 20;
  return Math.min(90, Math.max(45, 45 + Math.round((savedCount / Math.max(1, job.count)) * 35)));
}

function isTerminalStatus(status: JobWithImages["status"]) {
  return isTerminalGenerationStatus(status);
}

function progressTailLeft(percent: number) {
  return `${Math.min(99, Math.max(0, percent))}%`;
}

function phaseIn(phase: string | undefined, phases: string[]) {
  return Boolean(phase && phases.includes(phase));
}

function referenceCountFromProgressMessage(message: string) {
  const direct = message.match(/参考图\s*(\d+)\s*张/);
  if (direct?.[1]) return Number(direct[1]);
  const ready = message.match(/参考图[^（(]*(?:（|\()(\d+)\s*张/);
  if (ready?.[1]) return Number(ready[1]);
  return 0;
}

function referenceCountForJob(job: JobWithImages) {
  const progressCount = typeof job.progress?.referenceCount === "number"
    ? job.progress.referenceCount
    : referenceCountFromProgressMessage(job.progress?.message ?? "");
  const references = job.request_metadata?.references;
  const referencesCount = Array.isArray(references) ? references.length : 0;
  const reference = job.request_metadata?.reference;
  const legacyCount = reference && typeof reference === "object" ? 1 : 0;
  return Math.max(progressCount, referencesCount, legacyCount);
}

function getFlowSteps(job: JobWithImages): FlowStep[] {
  const phase = job.progress?.phase;
  const message = job.progress?.message ?? job.error_message ?? "";
  const savedCount = job.images.length;
  const hasSavedImages = savedCount > 0;
  const referenceCount = referenceCountForJob(job);
  const isFinished = job.status === "succeeded";
  // 'upstream_error' / 'interrupted' 在流程视图里都按"失败"渲染(标红 + 显示 error_message);
  // job.status 仍能在徽章里区分文案。
  const isFailed = job.status === "failed" || job.status === "upstream_error" || job.status === "interrupted";
  const isCanceled = job.status === "canceled";
  const isQueued = job.status === "queued";
  const referenceFailed = isFailed && (message.includes("参考图") || message.includes("任务参数"));
  const submitFailed = isFailed && (message.includes("提交模型") || message.includes("等待模型"));
  const receiveFailed = isFailed && (message.includes("读取模型返回") || message.includes("等待模型") || message.includes("模型"));
  const saveFailed = isFailed && (message.includes("保存图片") || message.includes("写入图片"));
  const referencesReady =
    phaseIn(phase, ["references_ready", "submitting", "requesting", "provider_returned", "downloading", "saving", "saved", "succeeded"]) ||
    isFinished ||
    hasSavedImages ||
    (isFailed && !referenceFailed);
  const modelReturned = phaseIn(phase, ["provider_returned", "downloading", "saving", "saved", "succeeded"]) || isFinished || hasSavedImages;

  return [
    {
      title: "创建任务",
      detail: isQueued ? "任务已写入数据库，等待后台 worker" : "任务已写入数据库",
      state: "done"
    },
    {
      title: "读取参考图",
      detail: isCanceled
        ? "任务已取消"
        : referenceFailed
          ? message
            : phase === "loading_references"
              ? referenceCount > 0
                ? `正在读取并编码参考图（${referenceCount} 张）`
                : "正在读取任务参数"
            : referencesReady
              ? referenceCount > 0
                ? `参考图已准备完成（${referenceCount} 张）`
                : "无参考图，跳过读取参考图"
              : referenceCount > 0
                ? `等待读取参考图（${referenceCount} 张）`
                : "等待读取任务参数",
      state: isCanceled ? "canceled" : referenceFailed ? "failed" : referencesReady ? "done" : phase === "loading_references" ? "active" : "pending"
    },
    {
      title: "提交模型",
      detail: isCanceled
        ? job.progress?.message ?? "任务已取消"
        : submitFailed
          ? message
          : phaseIn(phase, ["submitting", "requesting"])
            ? job.progress?.message ?? "请求已提交，等待模型返回"
            : modelReturned
              ? "模型请求已提交并返回"
              : "等待参考图准备完成后提交",
      state: isCanceled ? "canceled" : submitFailed ? "failed" : modelReturned ? "done" : phaseIn(phase, ["submitting", "requesting"]) ? "active" : "pending"
    },
    {
      title: "接收结果",
      detail: isCanceled
        ? "任务已取消"
        : receiveFailed && !hasSavedImages
          ? message
          : saveFailed
            ? "已收到模型返回图片"
            : phaseIn(phase, ["provider_returned", "downloading"])
            ? job.progress?.message ?? "模型已返回，正在读取图片"
            : phaseIn(phase, ["saving", "saved", "succeeded"]) || hasSavedImages
              ? "已收到模型返回图片"
              : "等待模型返回图片",
      state: isCanceled
        ? "canceled"
        : receiveFailed && !hasSavedImages
          ? "failed"
          : saveFailed || phaseIn(phase, ["saving", "saved", "succeeded"]) || hasSavedImages || isFinished
            ? "done"
            : phaseIn(phase, ["provider_returned", "downloading"])
              ? "active"
              : "pending"
    },
    {
      title: "保存图片",
      detail: isCanceled
        ? hasSavedImages
          ? `取消前已保存 ${savedCount}/${job.count} 张`
          : "任务取消后未保存新图片"
        : saveFailed
          ? message
          : phaseIn(phase, ["saving", "saved"])
            ? job.progress?.message ?? `已保存 ${savedCount}/${job.count} 张到本地`
            : hasSavedImages
              ? `已保存 ${savedCount}/${job.count} 张到本地`
              : isFailed
                ? "未保存成功图片"
                : "等待图片返回后保存",
      state: isFinished || hasSavedImages ? "done" : isCanceled ? "canceled" : saveFailed || (isFailed && !hasSavedImages && modelReturned) ? "failed" : phaseIn(phase, ["saving", "saved"]) ? "active" : "pending"
    },
    {
      title: "完成任务",
      detail: isFinished || isFailed || isCanceled ? job.progress?.message ?? (isFinished ? "任务已完成" : isCanceled ? "任务已取消" : job.error_message ?? "任务失败") : "任务进行中",
      state: isFinished ? "done" : isCanceled ? "canceled" : isFailed ? "failed" : "active"
    }
  ];
}

function rerunHref(job: Pick<JobWithImages, "prompt" | "model" | "size" | "count">) {
  const params = new URLSearchParams({
    prompt: job.prompt,
    model: job.model,
    size: job.size,
    count: String(job.count)
  });
  return `/?${params.toString()}`;
}

function formatDuration(valueMs: number) {
  const totalSeconds = Math.max(0, Math.round(valueMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds} 秒`;
  return `${minutes} 分 ${seconds} 秒`;
}

function durationLabel(job: JobWithImages) {
  if (typeof job.duration_ms === "number") return `生成耗时 ${formatDuration(job.duration_ms)}`;
  if (job.started_at && !isTerminalStatus(job.status)) {
    return `已用时 ${formatDuration(Date.now() - new Date(job.started_at).getTime())}`;
  }
  return "生成耗时 -";
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function requestMeta(job: JobWithImages) {
  const metadata = job.response_metadata;
  const requests = metadata && Array.isArray(metadata.requests) ? metadata.requests : [];
  return requests.find((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") ?? null;
}

function keyLabel(job: JobWithImages) {
  if (job.provider_key_label) return job.provider_key_label;
  if (job.provider_key_source === "env") return "环境变量 Key";
  const meta = requestMeta(job);
  if (typeof meta?.keyLabel === "string" && meta.keyLabel) return meta.keyLabel;
  if (typeof meta?.keySource === "string" && meta.keySource === "env") return "环境变量 Key";
  return "未记录";
}

function presetLabel(job: JobWithImages) {
  // 优先取 runner 实际跑出来的 preset 名(写在 response_metadata.requests[0].presetName),
  // 退到任务提交时选的 presetId(在 request_metadata.providerPresetId),都没有则按"默认"展示。
  const meta = requestMeta(job);
  const actualName =
    meta && typeof meta.presetName === "string" && meta.presetName.trim() ? meta.presetName.trim() : null;
  if (actualName) return actualName;

  const requested = job.request_metadata?.providerPresetId;
  if (typeof requested === "string" && requested.trim()) {
    return `Preset ${requested.slice(0, 8)}`;
  }
  return "默认";
}

function lineageLabel(image: GeneratedImage, showVersionChain: boolean) {
  if (image.parent_image_id) return "编辑图";
  if (showVersionChain) return "链路原图";
  return "原图";
}

function FlowProgress({ job }: { job: JobWithImages }) {
  const steps = getFlowSteps(job);
  const percent = getProgressPercent(job);

  return (
    <section className="flow-panel" aria-label="生成流程进度">
      <div className="flow-head">
        <div>
          <p className="small muted">流进度</p>
          <h2 className="panel-title">生成流程</h2>
          {job.progress ? <p className="small muted">{job.progress.message}</p> : null}
        </div>
        <span className={`status ${job.status}`}>{percent}%</span>
      </div>
      <div className="flow-track" aria-hidden="true">
        <div className={`flow-bar ${job.status}`} style={{ width: `${percent}%` }} />
        {!isTerminalStatus(job.status) ? <div className="flow-tail" style={{ left: progressTailLeft(percent) }} /> : null}
      </div>
      <div className="flow-steps">
        {steps.map((step) => (
          <div className="flow-step" key={step.title}>
            <span className={`flow-dot ${step.state}`} />
            <div>
              <strong>{step.title}</strong>
              <p className="small muted">{step.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function VersionChain({ nodes }: { nodes: ImageVersionNode[] }) {
  const lightboxItems: LightboxItem[] = nodes.map((node) => ({
    src: `/api/images/${node.id}`,
    downloadHref: `/api/images/${node.id}/download`,
    alt: node.depth === 0 ? "原图" : `修改版 ${node.depth}`
  }));

  return (
    <section className="version-panel" aria-label="图片版本链">
      <div className="flow-head">
        <div>
          <p className="small muted">图片对比 / 版本链</p>
          <h2 className="panel-title">修图链路</h2>
        </div>
        <span className="status">{nodes.length} 张</span>
      </div>
      <div className="version-chain">
        {nodes.map((node, index) => (
          <div className="version-step" key={node.id}>
            {index > 0 ? <span className="version-arrow">&gt;</span> : null}
            <article className={`version-node ${node.is_current ? "current" : ""}`}>
              <ImageLightbox
                src={`/api/images/${node.id}`}
                downloadHref={`/api/images/${node.id}/download`}
                alt={node.depth === 0 ? "原图" : `修改版 ${node.depth}`}
                items={lightboxItems}
                initialIndex={index}
              >
                <ImageWithSkeleton className="version-thumb" wrapperClassName="version-thumb-skeleton" src={imageThumbnailUrl(node.id)} alt="" />
              </ImageLightbox>
              <div className="version-node-body">
                <div className="actions">
                  <span className={`status ${node.is_current ? "succeeded" : ""}`}>
                    {node.depth === 0 ? "原图" : `修改版 ${node.depth}`}
                  </span>
                  {node.is_current ? <span className="status">当前任务</span> : null}
                </div>
                <p className="small muted">{node.width ?? "-"} x {node.height ?? "-"} · {formatDateTime(node.job_created_at)}</p>
                <p className="small version-prompt">{node.job_prompt.slice(0, 78)}</p>
                <div className="actions">
                  <a className="status action-button action-detail" href={`/records/${node.job_id}`}>详情</a>
                  <a className="status action-button action-edit" href={`/?referenceImageId=${node.id}`}>
                    <Pencil size={13} />
                    编辑
                  </a>
                  <a className="status action-button action-download" href={`/api/images/${node.id}/download`}>
                    <Download size={13} />
                    下载
                  </a>
                </div>
              </div>
            </article>
          </div>
        ))}
      </div>
    </section>
  );
}

export default async function RecordDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const [job, versionChain, themePreference] = await Promise.all([
    getJobById(id, user),
    listImageVersionChainForJob(id, user),
    getUiThemePreference()
  ]);
  if (!job) notFound();
  const showVersionChain = versionChain.some((node) => node.parent_image_id || !node.is_current);
  const lightboxItems: LightboxItem[] = job.images.map((image) => ({
    src: `/api/images/${image.id}`,
    downloadHref: `/api/images/${image.id}/download`,
    alt: "生成图片",
    compare: image.parent_image_id
      ? {
          src: `/api/images/${image.parent_image_id}`,
          alt: "主修改图",
          beforeLabel: "主修改图",
          afterLabel: "成品图"
        }
      : undefined
  }));

  return (
    <div className="shell" data-theme={themePreference.theme}>
      <AppNav user={user} themeMode={themePreference.mode} />
      <main className="main">
        <JobAutoRefresh status={job.status} />
        <section className="panel">
          <div className="panel-header">
            <h1 className="panel-title">任务详情</h1>
            <div className="actions">
              <span className={`status ${job.status}`}>{generationStatusLabel(job.status)}</span>
              <RerunButton href={rerunHref(job)} />
              {isRetryableGenerationStatus(job.status) ? (
                <JobControlButton action="requeue" recordId={job.id} />
              ) : null}
              {job.status === "queued" || job.status === "running" ? (
                <JobControlButton action="cancel" recordId={job.id} />
              ) : null}
              {job.status === "queued" || job.status === "running" ? null : (
                <DeleteRecordButton recordId={job.id} redirectTo="/records" />
              )}
            </div>
          </div>
          <div className="panel-body form-stack">
            <div>
              <div className="prompt-title-row">
                <p className="small muted">提示词</p>
                <CopyPromptButton prompt={job.prompt} />
              </div>
              <p>{job.prompt}</p>
            </div>
            <div className="actions">
              <span className="status">{job.model}</span>
              <span className="status">{job.size}</span>
              <span className="status">{job.username}</span>
              <span className="status">{formatDateTime(job.created_at)}</span>
              <span className="status">{durationLabel(job)}</span>
            </div>
            <FlowProgress job={job} />
            {showVersionChain ? <VersionChain nodes={versionChain} /> : null}
            {job.error_message ? <p style={{ color: "var(--danger)" }}>{job.error_message}</p> : null}
            <div className="preview-grid">
              {job.images.map((image, index) => (
                <article className="image-card" key={image.id}>
                  <ImageLightbox
                    src={`/api/images/${image.id}`}
                    downloadHref={`/api/images/${image.id}/download`}
                    alt="生成图片"
                    items={lightboxItems}
                    initialIndex={index}
                  >
                    <ImageWithSkeleton src={imageThumbnailUrl(image.id)} alt="生成图片" />
                  </ImageLightbox>
                  <footer>
                    <div className="asset-card-head">
                      <span className="small muted">图片 #{index + 1}</span>
                      <div className="asset-card-head-actions">
                        {image.parent_image_id ? <span className="status compare-available">可对比</span> : null}
                        <FavoriteImageButton imageId={image.id} initialFavorite={image.is_favorite ?? false} />
                      </div>
                    </div>
                    <div className="asset-meta-grid">
                      <div>
                        <span>尺寸</span>
                        <strong>{image.width ?? "-"} x {image.height ?? "-"}</strong>
                      </div>
                      <div>
                        <span>文件</span>
                        <strong>{formatBytes(image.byte_size)}</strong>
                      </div>
                      <div>
                        <span>耗时</span>
                        <strong>{durationLabel(job).replace("生成耗时 ", "")}</strong>
                      </div>
                      <div>
                        <span>模型</span>
                        <strong>{job.model}</strong>
                      </div>
                      <div>
                        <span>Key</span>
                        <strong>{keyLabel(job)}</strong>
                      </div>
                      <div>
                        <span>Preset</span>
                        <strong>{presetLabel(job)}</strong>
                      </div>
                      <div>
                        <span>链路</span>
                        <strong>{lineageLabel(image, showVersionChain)}</strong>
                      </div>
                    </div>
                    <div className="image-card-meta asset-tags-row">
                      <ImageTagsEditor imageId={image.id} initialTags={image.tags ?? []} />
                    </div>
                    <div className="actions image-card-actions">
                      <ReferenceBasketButton imageId={image.id} prompt={job.prompt} />
                      <a className="status action-button action-edit" href={`/?referenceImageId=${image.id}`}>
                        <Pencil size={13} />
                        编辑
                      </a>
                      <a className="status action-button action-download" href={`/api/images/${image.id}/download`}>
                        <Download size={13} />
                        下载
                      </a>
                    </div>
                  </footer>
                </article>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
