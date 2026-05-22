"use client";

import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ImageIcon, Pencil, RefreshCw, Search, Trash2, Eraser, Copy } from "lucide-react";
import { useState } from "react";
import { ImageLightbox } from "./image-lightbox";
import { formatDateTime } from "@/lib/time";
import { DangerConfirmDialog } from "./danger-confirm-dialog";

type RelatedJob = {
  id: string;
  prompt: string;
  status: string;
  created_at: string;
};

type RefImageRaw = {
  id: string;
  user_id: string;
  local_path: string;
  mime_type: string;
  byte_size: number;
  checksum: string;
  created_at: string;
  username: string;
  usage_count: number;
  last_used_at: string | null;
  related_jobs: RelatedJob[] | null;
};

type RefImage = RefImageRaw & {
  isDuplicate: boolean;
};

type ReferenceConfirmAction =
  | { action: "delete"; id: string }
  | { action: "cleanup_unused"; count: number }
  | { action: "merge_duplicates"; count: number };

function markDuplicates(images: RefImageRaw[]): RefImage[] {
  const seen = new Map<string, number>();
  for (const img of images) {
    seen.set(img.checksum, (seen.get(img.checksum) ?? 0) + 1);
  }
  return images.map((img) => ({
    ...img,
    isDuplicate: (seen.get(img.checksum) ?? 1) > 1
  }));
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function mimeLabel(mime: string) {
  if (mime === "image/png") return "PNG";
  if (mime === "image/jpeg") return "JPEG";
  if (mime === "image/webp") return "WebP";
  return mime.split("/")[1]?.toUpperCase() ?? mime;
}

function statusLabel(status: string) {
  if (status === "succeeded") return "成功";
  if (status === "failed") return "失败";
  if (status === "canceled") return "已取消";
  if (status === "running") return "运行中";
  if (status === "queued") return "排队中";
  return status;
}

function ReferenceCard({
  image,
  deleting,
  onDelete,
  expandedId,
  onToggleExpand
}: {
  image: RefImage;
  deleting: boolean;
  onDelete: () => void;
  expandedId: string | null;
  onToggleExpand: (id: string) => void;
}) {
  const used = image.usage_count > 0;
  const expanded = expandedId === image.id;

  const fullSrc = `/api/reference-images/${image.id}`;

  return (
    <div className={`reference-card${used ? "" : " unused"}${image.isDuplicate ? " duplicate" : ""}`}>
      <ImageLightbox src={fullSrc} downloadHref={fullSrc} alt="参考图">
        <img
          src={`${fullSrc}?thumb=1`}
          alt="参考图"
          loading="lazy"
          draggable={false}
        />
      </ImageLightbox>
      <div className="reference-card-info">
        <div className="reference-card-status">
          {used ? (
            <span className="reference-badge used">已使用 ×{image.usage_count}</span>
          ) : (
            <span className="reference-badge unused">未使用</span>
          )}
          {image.isDuplicate ? (
            <span className="reference-badge duplicate"><Copy size={10} /> 重复</span>
          ) : null}
        </div>
        <span className="small">{mimeLabel(image.mime_type)} · {formatBytes(image.byte_size)}</span>
        <span className="small muted">{image.username} · {formatDateTime(image.created_at)}</span>
      </div>

      {used && image.related_jobs && image.related_jobs.length > 0 ? (
        <div className="reference-usage-section">
          <button
            className="reference-usage-toggle"
            type="button"
            onClick={() => onToggleExpand(image.id)}
          >
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            关联生成 ({image.related_jobs.length})
          </button>
          {expanded ? (
            <ul className="reference-usage-list">
              {image.related_jobs.map((job) => (
                <li key={job.id}>
                  <a href={`/records/${job.id}`} className="reference-usage-item">
                    <span className="reference-usage-prompt">{job.prompt || "（无提示词）"}</span>
                    <span className="small muted">{statusLabel(job.status)} · {formatDateTime(job.created_at)}</span>
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="reference-actions">
        <a className="button action-button action-edit small" href={`/?refImageId=${image.id}`}>
          <Pencil size={13} />
          用作参考图
        </a>
        <button
          className="button action-button action-danger small"
          type="button"
          disabled={deleting}
          onClick={onDelete}
        >
          <Trash2 size={13} />
          {deleting ? "删除中" : "删除"}
        </button>
      </div>
    </div>
  );
}

export function ReferenceImagesPanel() {
  const [images, setImages] = useState<RefImage[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [cleaningUp, setCleaningUp] = useState(false);
  const [merging, setMerging] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmAction, setConfirmAction] = useState<ReferenceConfirmAction | null>(null);
  const [confirmError, setConfirmError] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 24;

  async function loadImages(targetPage = page) {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch(`/api/reference-images?page=${targetPage}&pageSize=${pageSize}`, { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as { images?: RefImageRaw[]; total?: number; error?: string };
      if (!response.ok || !Array.isArray(data.images)) {
        setMessage(data.error ?? "加载失败");
        return;
      }
      setImages(markDuplicates(data.images));
      setTotal(data.total ?? 0);
      setPage(targetPage);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string) {
    setConfirmError("");
    setDeletingId(id);
    setMessage("");
    try {
      const response = await fetch("/api/reference-images", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id })
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setConfirmError(data.error ?? "删除失败");
        return;
      }
      setImages((current) => current?.filter((img) => img.id !== id) ?? null);
      setConfirmAction(null);
      setMessage("已删除");
    } finally {
      setDeletingId(null);
    }
  }

  function requestCleanupUnused() {
    const unusedCount = images?.filter((img) => img.usage_count === 0).length ?? 0;
    if (unusedCount === 0) {
      setMessage("没有未使用的参考图");
      return;
    }
    setConfirmError("");
    setConfirmAction({ action: "cleanup_unused", count: unusedCount });
  }

  async function handleCleanupUnused() {
    setConfirmError("");
    setCleaningUp(true);
    setMessage("");
    try {
      const response = await fetch("/api/reference-images", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "cleanup_unused" })
      });
      const data = (await response.json().catch(() => ({}))) as { deleted?: number; errors?: number; error?: string };
      if (!response.ok) {
        setConfirmError(data.error ?? "清理失败");
        return;
      }
      setConfirmAction(null);
      setMessage(`已清理 ${data.deleted ?? 0} 张未使用参考图${data.errors ? `，${data.errors} 个文件删除失败` : ""}`);
      void loadImages(1);
    } finally {
      setCleaningUp(false);
    }
  }

  function requestMergeDuplicates() {
    const dupCount = images?.filter((img) => img.isDuplicate).length ?? 0;
    if (dupCount === 0) {
      setMessage("没有重复的参考图");
      return;
    }
    setConfirmError("");
    setConfirmAction({ action: "merge_duplicates", count: dupCount });
  }

  async function handleMergeDuplicates() {
    setConfirmError("");
    setMerging(true);
    setMessage("");
    try {
      const response = await fetch("/api/reference-images", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "merge_duplicates" })
      });
      const data = (await response.json().catch(() => ({}))) as { merged?: number; filesRemoved?: number; errors?: number; error?: string };
      if (!response.ok) {
        setConfirmError(data.error ?? "合并失败");
        return;
      }
      setConfirmAction(null);
      setMessage(`已合并 ${data.merged ?? 0} 组重复参考图，清理 ${data.filesRemoved ?? 0} 个文件${data.errors ? `，${data.errors} 个文件删除失败` : ""}`);
      void loadImages(1);
    } finally {
      setMerging(false);
    }
  }

  function requestDelete(id: string) {
    setConfirmError("");
    setConfirmAction({ action: "delete", id });
  }

  function closeConfirm() {
    if (deletingId || cleaningUp || merging) return;
    setConfirmAction(null);
    setConfirmError("");
  }

  async function runConfirmedAction() {
    if (!confirmAction) return;
    if (confirmAction.action === "delete") {
      await handleDelete(confirmAction.id);
      return;
    }
    if (confirmAction.action === "cleanup_unused") {
      await handleCleanupUnused();
      return;
    }
    await handleMergeDuplicates();
  }

  function toggleExpand(id: string) {
    setExpandedId((current) => (current === id ? null : id));
  }

  const totalBytes = images?.reduce((sum, img) => sum + img.byte_size, 0) ?? 0;
  const duplicateCount = images?.filter((img) => img.isDuplicate).length ?? 0;
  const unusedCount = images?.filter((img) => img.usage_count === 0).length ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const confirmLoading = Boolean(deletingId) || cleaningUp || merging;
  const confirmTitle =
    confirmAction?.action === "delete"
      ? "确认删除参考图"
      : confirmAction?.action === "cleanup_unused"
        ? "确认清理未使用参考图"
        : "确认合并重复参考图";
  const confirmDescription =
    confirmAction?.action === "delete"
      ? "会同时删除参考图文件和数据库记录，操作不可恢复。"
      : confirmAction?.action === "cleanup_unused"
        ? `会清理当前筛选出的 ${confirmAction.count} 张未使用参考图，文件和数据库记录都会被移除。`
        : confirmAction
          ? `检测到 ${confirmAction.count} 张重复参考图，合并后每组仅保留最早的一条记录，关联的生成记录会自动迁移。`
          : "";
  const confirmLabel =
    confirmAction?.action === "delete" ? "删除参考图" : confirmAction?.action === "cleanup_unused" ? "清理未使用" : "合并重复";
  const confirmLoadingLabel =
    confirmAction?.action === "delete" ? "删除中" : confirmAction?.action === "cleanup_unused" ? "清理中" : "合并中";
  const confirmIcon =
    confirmAction?.action === "merge_duplicates" ? <Copy size={16} /> : confirmAction?.action === "cleanup_unused" ? <Eraser size={16} /> : <Trash2 size={16} />;

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 className="panel-title">
          <ImageIcon size={17} /> 参考图管理
        </h2>
        <button className="status action-button action-refresh" type="button" onClick={() => void loadImages()} disabled={loading}>
          {loading ? <RefreshCw size={13} /> : <Search size={13} />}
          {loading ? "加载中" : images ? "刷新" : "加载"}
        </button>
      </div>
      <div className="panel-body form-stack">
        {images ? (
          images.length > 0 ? (
            <>
              <div className="actions">
                <span className="status">共 {total} 张</span>
                <span className="status">本页 {formatBytes(totalBytes)}</span>
                {duplicateCount > 0 ? (
                  <button
                    className="button action-button action-validate small"
                    type="button"
                    disabled={merging}
                    onClick={requestMergeDuplicates}
                  >
                    <Copy size={13} />
                    {merging ? "合并中" : `合并重复 (${duplicateCount})`}
                  </button>
                ) : null}
                {unusedCount > 0 ? (
                  <button
                    className="button action-button action-danger small"
                    type="button"
                    disabled={cleaningUp}
                    onClick={requestCleanupUnused}
                  >
                    <Eraser size={13} />
                    {cleaningUp ? "清理中" : `清理未使用 (${unusedCount})`}
                  </button>
                ) : null}
              </div>
              <div className="reference-grid">
                {images.map((img) => (
                  <ReferenceCard
                    key={img.id}
                    image={img}
                    deleting={deletingId === img.id}
                    onDelete={() => requestDelete(img.id)}
                    expandedId={expandedId}
                    onToggleExpand={toggleExpand}
                  />
                ))}
              </div>
              {totalPages > 1 ? (
                <div className="actions" style={{ justifyContent: "center" }}>
                  <button
                    className="status action-button action-neutral"
                    type="button"
                    disabled={loading || page <= 1}
                    onClick={() => loadImages(page - 1)}
                  >
                    <ChevronLeft size={13} />
                    上一页
                  </button>
                  <span className="status">{page} / {totalPages}</span>
                  <button
                    className="status action-button action-neutral"
                    type="button"
                    disabled={loading || page >= totalPages}
                    onClick={() => loadImages(page + 1)}
                  >
                    下一页
                    <ChevronRight size={13} />
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <p className="small muted">暂无参考图。用户在生成图片时上传的参考图会出现在这里。</p>
          )
        ) : (
          <p className="small muted">点击"加载"查看所有用户上传的参考图。</p>
        )}

        {message ? <p className="small muted">{message}</p> : null}
      </div>
      <DangerConfirmDialog
        open={Boolean(confirmAction)}
        title={confirmTitle}
        description={confirmDescription}
        confirmLabel={confirmLabel}
        loadingLabel={confirmLoadingLabel}
        loading={confirmLoading}
        error={confirmError}
        confirmIcon={confirmIcon}
        onClose={closeConfirm}
        onConfirm={() => {
          void runConfirmedAction();
        }}
      />
    </section>
  );
}
