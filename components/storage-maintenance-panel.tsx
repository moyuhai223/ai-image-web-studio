"use client";

import { DatabaseZap, Eraser, ImageDown, RotateCcw, Search } from "lucide-react";
import { useState } from "react";
import { formatDateTime } from "@/lib/time";
import { DangerConfirmDialog } from "./danger-confirm-dialog";

type StorageFileEntry = {
  path: string;
  byteSize: number;
};

type StorageMaintenanceScan = {
  root: string;
  scannedAt: string;
  totalFiles: number;
  totalBytes: number;
  orphanCount: number;
  orphanBytes: number;
  orphanFiles: StorageFileEntry[];
  generatedImages: number;
  referenceImages: number;
  expectedThumbnails: number;
  existingThumbnails: number;
  missingThumbnails: number;
  failedJobs: number;
  failedImages: number;
  failedImageBytes: number;
};

type StorageMaintenanceResult = {
  ok: boolean;
  deletedFiles?: number;
  deletedBytes?: number;
  deletedImages?: number;
  rebuilt?: number;
  failed?: number;
  fileErrors?: number;
  errors?: string[];
  scan?: StorageMaintenanceScan;
};

type ApiResponse = {
  scan?: StorageMaintenanceScan;
  result?: StorageMaintenanceResult;
  error?: string;
};

type Action = "cleanup_orphans" | "rebuild_thumbnails" | "cleanup_failed_images";

const actionCopy: Record<Action, { title: string; description: string; confirmLabel: string; loadingLabel: string }> = {
  cleanup_orphans: {
    title: "确认清理孤儿文件",
    description: "会删除数据库中没有记录但本地仍存在的图片文件，操作不可恢复。",
    confirmLabel: "清理孤儿文件",
    loadingLabel: "清理中"
  },
  rebuild_thumbnails: {
    title: "确认重新生成缩略图",
    description: "会覆盖生成图片和参考图的缩略图缓存，原图不会被删除。",
    confirmLabel: "重新生成",
    loadingLabel: "生成中"
  },
  cleanup_failed_images: {
    title: "确认清理失败任务图片",
    description: "会删除失败任务下已保存的图片文件和图片记录，任务记录会保留。",
    confirmLabel: "清理图片",
    loadingLabel: "清理中"
  }
};

function actionIcon(action: Action) {
  if (action === "cleanup_orphans") return <Eraser size={16} />;
  if (action === "rebuild_thumbnails") return <ImageDown size={16} />;
  return <RotateCcw size={16} />;
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatTime(value?: string) {
  return formatDateTime(value);
}

function resultMessage(result: StorageMaintenanceResult) {
  const parts = [];
  if (typeof result.deletedFiles === "number") parts.push(`删除文件 ${result.deletedFiles} 个`);
  if (typeof result.deletedImages === "number") parts.push(`清理图片记录 ${result.deletedImages} 条`);
  if (typeof result.deletedBytes === "number") parts.push(`释放 ${formatBytes(result.deletedBytes)}`);
  if (typeof result.rebuilt === "number") parts.push(`重建缩略图 ${result.rebuilt} 个`);
  if (typeof result.failed === "number" && result.failed > 0) parts.push(`失败 ${result.failed} 个`);
  if (typeof result.fileErrors === "number" && result.fileErrors > 0) parts.push(`文件错误 ${result.fileErrors} 个`);
  return parts.join("，") || "操作已完成";
}

export function StorageMaintenancePanel() {
  const [scan, setScan] = useState<StorageMaintenanceScan | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState<Action | "scan" | null>(null);
  const [confirmAction, setConfirmAction] = useState<Action | null>(null);
  const [confirmError, setConfirmError] = useState("");

  async function loadScan() {
    setLoading("scan");
    setMessage("");
    const response = await fetch("/api/storage-maintenance", { cache: "no-store" });
    const data = (await response.json().catch(() => ({}))) as ApiResponse;
    setLoading(null);

    if (!response.ok || !data.scan) {
      setMessage(data.error ?? "扫描失败");
      return;
    }

    setScan(data.scan);
    setMessage("扫描完成");
  }

  function requestAction(action: Action) {
    setConfirmError("");
    setConfirmAction(action);
  }

  function closeConfirm() {
    if (loading && confirmAction === loading) return;
    setConfirmAction(null);
    setConfirmError("");
  }

  async function runAction() {
    if (!confirmAction) return;

    const action = confirmAction;
    setConfirmError("");
    setLoading(action);
    setMessage("");
    const response = await fetch("/api/storage-maintenance", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action })
    });
    const data = (await response.json().catch(() => ({}))) as ApiResponse;
    setLoading(null);

    if (!response.ok || !data.result) {
      setConfirmError(data.error ?? "操作失败");
      return;
    }

    if (data.result.scan) setScan(data.result.scan);
    setMessage(resultMessage(data.result));
    setConfirmAction(null);
  }

  const currentActionCopy = confirmAction ? actionCopy[confirmAction] : null;

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 className="panel-title">
          <DatabaseZap size={17} /> 存储维护
        </h2>
        <button className="status" type="button" onClick={loadScan} disabled={Boolean(loading)}>
          <Search size={13} />
          {loading === "scan" ? "扫描中" : "扫描"}
        </button>
      </div>
      <div className="panel-body form-stack">
        {scan ? (
          <>
            <div className="storage-metrics">
              <div className="storage-metric">
                <strong>{scan.totalFiles}</strong>
                <span className="small muted">扫描文件</span>
                <span className="small muted">{formatBytes(scan.totalBytes)}</span>
              </div>
              <div className="storage-metric">
                <strong>{scan.orphanCount}</strong>
                <span className="small muted">孤儿文件</span>
                <span className="small muted">{formatBytes(scan.orphanBytes)}</span>
              </div>
              <div className="storage-metric">
                <strong>{scan.missingThumbnails}</strong>
                <span className="small muted">缺失缩略图</span>
                <span className="small muted">{scan.existingThumbnails} / {scan.expectedThumbnails}</span>
              </div>
              <div className="storage-metric">
                <strong>{scan.failedImages}</strong>
                <span className="small muted">失败任务图片</span>
                <span className="small muted">{formatBytes(scan.failedImageBytes)}</span>
              </div>
            </div>
            <div className="actions">
              <span className="status">生成图 {scan.generatedImages}</span>
              <span className="status">参考图 {scan.referenceImages}</span>
              <span className="status">失败任务 {scan.failedJobs}</span>
              <span className="status">扫描时间 {formatTime(scan.scannedAt)}</span>
            </div>
            <p className="small muted break-text">存储目录：{scan.root}</p>
            {scan.orphanFiles.length > 0 ? (
              <div className="storage-orphan-list">
                <strong>孤儿文件预览</strong>
                {scan.orphanFiles.map((file) => (
                  <div className="storage-orphan-row" key={file.path}>
                    <span className="small break-text">{file.path}</span>
                    <span className="small muted">{formatBytes(file.byteSize)}</span>
                  </div>
                ))}
                {scan.orphanCount > scan.orphanFiles.length ? (
                  <p className="small muted">仅显示前 {scan.orphanFiles.length} 条，还有 {scan.orphanCount - scan.orphanFiles.length} 条未展示。</p>
                ) : null}
              </div>
            ) : (
              <p className="small muted">未发现孤儿文件。</p>
            )}
          </>
        ) : (
          <p className="small muted">点击“扫描”后查看本地图片、参考图、缩略图和失败任务图片状态。</p>
        )}

        {message ? <p className="small muted">{message}</p> : null}

        <div className="storage-actions">
          <button className="button danger" type="button" disabled={Boolean(loading) || !scan || scan.orphanCount <= 0} onClick={() => requestAction("cleanup_orphans")}>
            <Eraser size={17} />
            {loading === "cleanup_orphans" ? "清理中" : "清理孤儿文件"}
          </button>
          <button className="button secondary" type="button" disabled={Boolean(loading)} onClick={() => requestAction("rebuild_thumbnails")}>
            <ImageDown size={17} />
            {loading === "rebuild_thumbnails" ? "生成中" : "重新生成缩略图"}
          </button>
          <button className="button danger" type="button" disabled={Boolean(loading) || Boolean(scan && scan.failedImages <= 0)} onClick={() => requestAction("cleanup_failed_images")}>
            <RotateCcw size={17} />
            {loading === "cleanup_failed_images" ? "清理中" : "清理失败任务图片"}
          </button>
        </div>
      </div>
      {currentActionCopy && confirmAction ? (
        <DangerConfirmDialog
          open={Boolean(confirmAction)}
          title={currentActionCopy.title}
          description={currentActionCopy.description}
          confirmLabel={currentActionCopy.confirmLabel}
          loadingLabel={currentActionCopy.loadingLabel}
          loading={loading === confirmAction}
          error={confirmError}
          confirmIcon={actionIcon(confirmAction)}
          onClose={closeConfirm}
          onConfirm={runAction}
        />
      ) : null}
    </section>
  );
}
