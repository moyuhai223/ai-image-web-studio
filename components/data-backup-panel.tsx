"use client";

import { useEffect, useState } from "react";
import { Archive, CalendarClock, CheckCircle2, Download, RefreshCw, RotateCcw, SearchCheck, Trash2, Upload } from "lucide-react";
import { formatDateTime } from "@/lib/time";
import { DangerConfirmDialog } from "./danger-confirm-dialog";

type DataBackupItem = {
  filename: string;
  byteSize: number;
  createdAt: string;
  modifiedAt: string;
};

type BackupResponse = {
  backups?: DataBackupItem[];
  policy?: AutoBackupPolicy;
  backup?: DataBackupItem & {
    fileCount?: number;
    fileBytes?: number;
  };
  validation?: DataBackupValidationResult;
  uploadedFilename?: string | null;
  result?: {
    restoredFrom: string;
    safetyBackup: DataBackupItem;
    fileCount: number;
    fileBytes: number;
  };
  error?: string;
};

type AutoBackupPolicy = {
  enabled: boolean;
  intervalHours: number;
  retainCount: number;
  lastRunAt: string | null;
  lastBackupFilename: string | null;
  lastError: string | null;
  updatedAt: string | null;
};

type DataBackupValidationResult = {
  filename: string;
  ok: true;
  appVersion: string | null;
  createdAt: string | null;
  tableCounts: Record<string, number>;
  fileCount: number;
  fileBytes: number;
  manifestFileCount: number | null;
  manifestFileBytes: number | null;
  warnings: string[];
};

type RestoreConfirm =
  | { type: "local"; filename: string }
  | { type: "upload"; file: File };

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function backupDownloadHref(filename: string) {
  return `/api/backups/${encodeURIComponent(filename)}`;
}

export function DataBackupPanel() {
  const [backups, setBackups] = useState<DataBackupItem[]>([]);
  const [policy, setPolicy] = useState<AutoBackupPolicy>({
    enabled: false,
    intervalHours: 24,
    retainCount: 7,
    lastRunAt: null,
    lastBackupFilename: null,
    lastError: null,
    updatedAt: null
  });
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deletingFilename, setDeletingFilename] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [validatingFilename, setValidatingFilename] = useState<string | null>(null);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [confirmDeleteFilename, setConfirmDeleteFilename] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<RestoreConfirm | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [validation, setValidation] = useState<DataBackupValidationResult | null>(null);
  const [message, setMessage] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [restoreError, setRestoreError] = useState("");

  async function loadBackups() {
    setLoading(true);
    setMessage("");
    const response = await fetch("/api/backups", { cache: "no-store" });
    const data = (await response.json().catch(() => ({}))) as BackupResponse;
    setLoading(false);

    if (!response.ok || !Array.isArray(data.backups)) {
      setMessage(data.error ?? "备份列表加载失败");
      return;
    }

    setBackups(data.backups);
    if (data.policy) setPolicy(data.policy);
  }

  useEffect(() => {
    void loadBackups();
  }, []);

  async function createBackup() {
    setCreating(true);
    setMessage("正在创建备份，图片较多时可能需要等待一会儿。");
    const response = await fetch("/api/backups", { method: "POST" });
    const data = (await response.json().catch(() => ({}))) as BackupResponse;
    setCreating(false);

    if (!response.ok || !data.backup || !Array.isArray(data.backups)) {
      setMessage(data.error ?? "创建备份失败");
      return;
    }

    setBackups(data.backups);
    setMessage(`备份已创建：${data.backup.filename}`);
  }

  function busy() {
    return loading || creating || Boolean(deletingFilename) || restoring || Boolean(validatingFilename) || savingPolicy;
  }

  function openDeleteConfirm(filename: string) {
    setDeleteError("");
    setConfirmDeleteFilename(filename);
  }

  function closeDeleteConfirm() {
    if (deletingFilename) return;
    setConfirmDeleteFilename(null);
    setDeleteError("");
  }

  async function deleteBackup() {
    if (!confirmDeleteFilename) return;
    setDeletingFilename(confirmDeleteFilename);
    setDeleteError("");
    setMessage("");
    const response = await fetch("/api/backups", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filename: confirmDeleteFilename })
    });
    const data = (await response.json().catch(() => ({}))) as BackupResponse;
    setDeletingFilename(null);

    if (!response.ok || !Array.isArray(data.backups)) {
      setDeleteError(data.error ?? "删除备份失败");
      return;
    }

    setBackups(data.backups);
    setConfirmDeleteFilename(null);
    setMessage("备份已删除");
  }

  async function validateBackup(filename: string) {
    setValidatingFilename(filename);
    setValidation(null);
    setMessage("正在校验备份包。");
    const response = await fetch("/api/backups/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filename })
    });
    const data = (await response.json().catch(() => ({}))) as BackupResponse;
    setValidatingFilename(null);

    if (!response.ok || !data.validation) {
      setMessage(data.error ?? "备份校验失败");
      return;
    }

    setValidation(data.validation);
    if (Array.isArray(data.backups)) setBackups(data.backups);
    setMessage(`校验通过：${data.validation.filename}`);
  }

  async function validateUpload() {
    if (!uploadFile) {
      setMessage("请先选择 .tar.gz 备份包");
      return;
    }

    setValidatingFilename(uploadFile.name);
    setValidation(null);
    setMessage("正在上传并校验备份包。");
    const formData = new FormData();
    formData.append("file", uploadFile);
    const response = await fetch("/api/backups/validate", {
      method: "POST",
      body: formData
    });
    const data = (await response.json().catch(() => ({}))) as BackupResponse;
    setValidatingFilename(null);

    if (!response.ok || !data.validation) {
      setMessage(data.error ?? "上传校验失败");
      return;
    }

    setValidation(data.validation);
    if (Array.isArray(data.backups)) setBackups(data.backups);
    setMessage(`上传并校验通过：${data.validation.filename}`);
  }

  function openRestoreConfirm(filename: string) {
    setRestoreError("");
    setConfirmRestore({ type: "local", filename });
  }

  function openUploadRestoreConfirm() {
    if (!uploadFile) {
      setMessage("请先选择 .tar.gz 备份包");
      return;
    }
    setRestoreError("");
    setConfirmRestore({ type: "upload", file: uploadFile });
  }

  function closeRestoreConfirm() {
    if (restoring) return;
    setConfirmRestore(null);
    setRestoreError("");
  }

  async function restoreBackup() {
    if (!confirmRestore) return;
    setRestoring(true);
    setRestoreError("");
    setMessage("正在恢复备份，请不要关闭页面。");

    const request =
      confirmRestore.type === "local"
        ? fetch("/api/backups/restore", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ filename: confirmRestore.filename })
          })
        : (() => {
            const formData = new FormData();
            formData.append("file", confirmRestore.file);
            return fetch("/api/backups/restore", {
              method: "POST",
              body: formData
            });
          })();

    const response = await request;
    const data = (await response.json().catch(() => ({}))) as BackupResponse;
    setRestoring(false);

    if (!response.ok || !data.result || !Array.isArray(data.backups)) {
      setRestoreError(data.error ?? "恢复备份失败");
      setMessage("");
      return;
    }

    setBackups(data.backups);
    setConfirmRestore(null);
    setUploadFile(null);
    setValidation(null);
    setMessage(`恢复完成：${data.result.restoredFrom}。恢复前安全备份：${data.result.safetyBackup.filename}`);
  }

  async function savePolicy() {
    setSavingPolicy(true);
    setMessage("正在保存自动备份设置。");
    const response = await fetch("/api/backups/policy", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        enabled: policy.enabled,
        intervalHours: policy.intervalHours,
        retainCount: policy.retainCount
      })
    });
    const data = (await response.json().catch(() => ({}))) as BackupResponse;
    setSavingPolicy(false);

    if (!response.ok || !data.policy) {
      setMessage(data.error ?? "自动备份设置保存失败");
      return;
    }

    setPolicy(data.policy);
    setMessage(data.policy.enabled ? "自动备份已启用" : "自动备份已关闭");
  }

  const totalBytes = backups.reduce((sum, backup) => sum + backup.byteSize, 0);
  const validationTables = validation ? Object.entries(validation.tableCounts) : [];
  const restoreTarget =
    confirmRestore?.type === "local"
      ? confirmRestore.filename
      : confirmRestore?.type === "upload"
        ? confirmRestore.file.name
        : "";

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 className="panel-title">
          <Archive size={17} /> 数据备份
        </h2>
        <button className="status action-button action-refresh" type="button" onClick={loadBackups} disabled={loading || creating || Boolean(deletingFilename)}>
          <RefreshCw size={13} />
          {loading ? "加载中" : "刷新"}
        </button>
      </div>
      <div className="panel-body form-stack">
        <div className="actions">
          <span className="status">{backups.length} 个备份</span>
          <span className="status">占用 {formatBytes(totalBytes)}</span>
          <span className="status">保存到 storage/backups</span>
        </div>
        <p className="small muted">备份包包含数据库核心表、生成图片、参考图和缩略图。恢复会覆盖当前数据库和图片目录，执行前会自动生成一份当前数据安全备份。</p>
        <div className="storage-actions">
          <button className="button action-button action-add" type="button" disabled={busy()} onClick={createBackup}>
            <Archive size={17} />
            {creating ? "备份中" : "创建备份"}
          </button>
        </div>
        <div className="backup-policy-card">
          <div className="backup-policy-head">
            <strong>
              <CalendarClock size={16} />
              自动备份
            </strong>
            <span className={`status ${policy.enabled ? "succeeded" : "canceled"}`}>{policy.enabled ? "已启用" : "已关闭"}</span>
          </div>
          <div className="backup-policy-grid">
            <label className="toggle-field">
              <input
                type="checkbox"
                checked={policy.enabled}
                disabled={busy()}
                onChange={(event) => setPolicy((current) => ({ ...current, enabled: event.target.checked }))}
              />
              <span>启用自动备份</span>
            </label>
            <div className="field">
              <label htmlFor="backup-interval">间隔小时</label>
              <input
                className="input"
                id="backup-interval"
                type="number"
                min={1}
                max={720}
                value={policy.intervalHours}
                disabled={busy()}
                onChange={(event) => setPolicy((current) => ({ ...current, intervalHours: Number(event.target.value) }))}
              />
            </div>
            <div className="field">
              <label htmlFor="backup-retain">保留份数</label>
              <input
                className="input"
                id="backup-retain"
                type="number"
                min={1}
                max={100}
                value={policy.retainCount}
                disabled={busy()}
                onChange={(event) => setPolicy((current) => ({ ...current, retainCount: Number(event.target.value) }))}
              />
            </div>
            <button className="button action-button action-save" type="button" disabled={busy()} onClick={savePolicy}>
              <CheckCircle2 size={16} />
              {savingPolicy ? "保存中" : "保存策略"}
            </button>
          </div>
          <div className="key-health">
            <span className="small muted">上次运行 {policy.lastRunAt ? formatDateTime(policy.lastRunAt) : "未运行"}</span>
            <span className="small muted">最近备份 {policy.lastBackupFilename ?? "无"}</span>
            {policy.lastError ? <span className="small failed-text">错误 {policy.lastError}</span> : null}
          </div>
        </div>
        <div className="backup-upload-row">
          <input
            className="input"
            type="file"
            accept=".tar.gz,application/gzip,application/x-gzip"
            disabled={busy()}
            onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
          />
          <button className="button action-button action-restore" type="button" disabled={busy() || !uploadFile} onClick={openUploadRestoreConfirm}>
            <Upload size={17} />
            上传并恢复
          </button>
          <button className="button action-button action-validate" type="button" disabled={busy() || !uploadFile} onClick={validateUpload}>
            <SearchCheck size={17} />
            上传校验
          </button>
        </div>
        {message ? <p className="small muted">{message}</p> : null}
        {validation ? (
          <div className="backup-validation-card">
            <div className="backup-policy-head">
              <strong>
                <SearchCheck size={16} />
                校验结果
              </strong>
              <span className="status succeeded">通过</span>
            </div>
            <div className="key-health">
              <span className="small muted">文件 {validation.filename}</span>
              <span className="small muted">版本 {validation.appVersion ?? "未知"}</span>
              <span className="small muted">创建 {validation.createdAt ? formatDateTime(validation.createdAt) : "未知"}</span>
              <span className="small muted">图片 {validation.fileCount} 个 / {formatBytes(validation.fileBytes)}</span>
            </div>
            {validationTables.length > 0 ? (
              <div className="backup-table-counts">
                {validationTables.map(([name, count]) => (
                  <span className="status" key={name}>{name}: {count}</span>
                ))}
              </div>
            ) : null}
            {validation.warnings.length > 0 ? (
              <ul className="backup-warnings">
                {validation.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : (
              <p className="small muted">没有发现结构或 manifest 不一致问题。恢复前仍会再次校验并创建安全备份。</p>
            )}
          </div>
        ) : null}

        {backups.length > 0 ? (
          <div className="backup-list">
            {backups.map((backup) => (
              <div className="backup-row" key={backup.filename}>
                <div className="backup-meta">
                  <strong className="backup-filename">{backup.filename}</strong>
                  <div className="key-health">
                    <span className="small muted">大小 {formatBytes(backup.byteSize)}</span>
                    <span className="small muted">创建 {formatDateTime(backup.createdAt)}</span>
                    <span className="small muted">更新 {formatDateTime(backup.modifiedAt)}</span>
                  </div>
                </div>
                <div className="backup-actions">
                  <a className="button action-button action-download" href={backupDownloadHref(backup.filename)}>
                    <Download size={16} />
                    下载
                  </a>
                  <button
                    className="button action-button action-validate"
                    type="button"
                    disabled={busy()}
                    onClick={() => {
                      void validateBackup(backup.filename);
                    }}
                  >
                    <SearchCheck size={16} />
                    {validatingFilename === backup.filename ? "校验中" : "校验"}
                  </button>
                  <button
                    className="button action-button action-restore"
                    type="button"
                    disabled={busy()}
                    onClick={() => openRestoreConfirm(backup.filename)}
                  >
                    <RotateCcw size={16} />
                    恢复
                  </button>
                  <button
                    className="button action-button action-danger"
                    type="button"
                    disabled={deletingFilename === backup.filename || restoring}
                    onClick={() => openDeleteConfirm(backup.filename)}
                  >
                    <Trash2 size={16} />
                    {deletingFilename === backup.filename ? "删除中" : "删除"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="small muted">还没有备份文件。</p>
        )}
      </div>
      <DangerConfirmDialog
        open={Boolean(confirmDeleteFilename)}
        title="确认删除备份"
        description={`会删除服务器本地备份文件 ${confirmDeleteFilename ?? ""}，操作不可恢复。`}
        confirmLabel="删除备份"
        loadingLabel="删除中"
        loading={Boolean(deletingFilename)}
        error={deleteError}
        confirmIcon={<Trash2 size={16} />}
        onClose={closeDeleteConfirm}
        onConfirm={() => {
          void deleteBackup();
        }}
      />
      <DangerConfirmDialog
        open={Boolean(confirmRestore)}
        title="确认恢复备份"
        description={`会用 ${restoreTarget} 覆盖当前数据库和图片目录。恢复前会自动生成当前数据安全备份；当前有排队或运行任务时会拒绝恢复。`}
        confirmLabel="恢复备份"
        loadingLabel="恢复中"
        loading={restoring}
        error={restoreError}
        confirmIcon={<RotateCcw size={16} />}
        onClose={closeRestoreConfirm}
        onConfirm={() => {
          void restoreBackup();
        }}
      />
    </section>
  );
}
