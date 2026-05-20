"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Eraser, FileClock, Filter, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { DangerConfirmDialog } from "./danger-confirm-dialog";
import { formatDateTime } from "@/lib/time";

type AuditLogItem = {
  id: string;
  user_id: string | null;
  username: string;
  action: string;
  target_type: string;
  target_id: string | null;
  detail: Record<string, unknown>;
  ip: string | null;
  created_at: string;
};

type AuditLogResponse = {
  logs?: AuditLogItem[];
  deletedCount?: number;
  error?: string;
};

type AuditLogFilters = {
  keyword: string;
  username: string;
  action: string;
  targetType: string;
  from: string;
  to: string;
  limit: string;
};

const defaultFilters: AuditLogFilters = {
  keyword: "",
  username: "",
  action: "",
  targetType: "",
  from: "",
  to: "",
  limit: "100"
};

const targetTypeOptions = [
  ["", "全部对象"],
  ["generation_job", "生成记录"],
  ["reference_image", "参考图"],
  ["ai_key", "AI Key"],
  ["user", "用户"],
  ["backup", "备份"],
  ["storage", "存储"],
  ["prompt_template", "提示词模板"],
  ["provider_settings", "Provider 设置"],
  ["audit_logs", "审计日志"]
];

function detailText(detail: Record<string, unknown>) {
  const entries = Object.entries(detail).filter(([, value]) => value !== undefined && value !== null && value !== "");
  if (entries.length === 0) return "无详情";
  return entries.map(([key, value]) => `${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`).join(" · ");
}

function auditQuery(filters: AuditLogFilters) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    const trimmed = value.trim();
    if (trimmed) params.set(key, trimmed);
  });
  return params.toString();
}

export function AuditLogPanel() {
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [filters, setFilters] = useState<AuditLogFilters>(defaultFilters);
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [confirmError, setConfirmError] = useState("");
  const [message, setMessage] = useState("");

  async function loadLogs(nextFilters = filters) {
    setLoading(true);
    setMessage("");
    const response = await fetch(`/api/audit-logs?${auditQuery(nextFilters)}`, { cache: "no-store" });
    const data = (await response.json().catch(() => ({}))) as AuditLogResponse;
    setLoading(false);

    if (!response.ok || !Array.isArray(data.logs)) {
      setMessage(data.error ?? "审计日志加载失败");
      return;
    }

    setLogs(data.logs);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadLogs();
  }

  function resetFilters() {
    setFilters(defaultFilters);
    void loadLogs(defaultFilters);
  }

  async function clearLogs() {
    setClearing(true);
    setConfirmError("");

    const response = await fetch("/api/audit-logs", { method: "DELETE" });
    const data = (await response.json().catch(() => ({}))) as AuditLogResponse;
    setClearing(false);

    if (!response.ok || !Array.isArray(data.logs)) {
      setConfirmError(data.error ?? "清空失败");
      return;
    }

    setLogs(data.logs);
    setConfirmClearOpen(false);
    setMessage(`已清空 ${data.deletedCount ?? 0} 条审计日志`);
  }

  useEffect(() => {
    void loadLogs();
  }, []);

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 className="panel-title">
          <FileClock size={17} /> 审计日志
        </h2>
        <button className="status" type="button" onClick={() => void loadLogs()} disabled={loading}>
          <RefreshCw size={13} />
          {loading ? "加载中" : "刷新"}
        </button>
      </div>
      <div className="panel-body form-stack">
        <p className="small muted">记录管理员和批量记录操作，便于回看谁在什么时候改了关键数据。</p>
        <form className="audit-filter-grid" onSubmit={submit}>
          <input
            className="input"
            value={filters.keyword}
            onChange={(event) => setFilters((current) => ({ ...current, keyword: event.target.value }))}
            placeholder="关键词"
          />
          <input
            className="input"
            value={filters.username}
            onChange={(event) => setFilters((current) => ({ ...current, username: event.target.value }))}
            placeholder="用户"
          />
          <input
            className="input"
            value={filters.action}
            onChange={(event) => setFilters((current) => ({ ...current, action: event.target.value }))}
            placeholder="动作"
          />
          <select
            className="select"
            value={filters.targetType}
            onChange={(event) => setFilters((current) => ({ ...current, targetType: event.target.value }))}
            aria-label="对象类型"
          >
            {targetTypeOptions.map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
          <input
            className="input"
            type="date"
            value={filters.from}
            onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))}
            aria-label="开始日期"
          />
          <input
            className="input"
            type="date"
            value={filters.to}
            onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))}
            aria-label="结束日期"
          />
          <select
            className="select"
            value={filters.limit}
            onChange={(event) => setFilters((current) => ({ ...current, limit: event.target.value }))}
            aria-label="返回数量"
          >
            <option value="50">50 条</option>
            <option value="100">100 条</option>
            <option value="200">200 条</option>
            <option value="500">500 条</option>
          </select>
          <div className="audit-filter-actions">
            <button className="button secondary" type="submit" disabled={loading}>
              <Filter size={16} />
              筛选
            </button>
            <button className="button secondary" type="button" onClick={resetFilters} disabled={loading}>
              <RotateCcw size={16} />
              重置
            </button>
            <button className="button danger" type="button" onClick={() => setConfirmClearOpen(true)} disabled={loading || clearing}>
              <Eraser size={16} />
              清空
            </button>
          </div>
        </form>
        {message ? <p className="small failed-text">{message}</p> : null}
        {logs.length > 0 ? (
          <div className="audit-log-list">
            {logs.map((log) => (
              <article className="audit-log-row" key={log.id}>
                <div className="audit-log-main">
                  <strong>{log.action}</strong>
                  <p className="small muted">{detailText(log.detail)}</p>
                </div>
                <div className="audit-log-side">
                  <span className="status">{log.username || "system"}</span>
                  <span className="small muted">{formatDateTime(log.created_at)}</span>
                  <span className="small muted">{log.target_type}{log.target_id ? ` · ${log.target_id.slice(0, 8)}` : ""}</span>
                  {log.ip ? <span className="small muted">IP {log.ip}</span> : null}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="small muted">{loading ? "正在加载审计日志。" : "还没有审计日志。"}</p>
        )}
      </div>
      <DangerConfirmDialog
        open={confirmClearOpen}
        title="确认清空审计日志"
        description="会删除当前全部审计日志，并留下本次清空操作记录。这个操作不可恢复。"
        confirmLabel="清空日志"
        loadingLabel="清空中"
        loading={clearing}
        error={confirmError}
        confirmIcon={<Trash2 size={16} />}
        onClose={() => {
          if (!clearing) {
            setConfirmClearOpen(false);
            setConfirmError("");
          }
        }}
        onConfirm={() => {
          void clearLogs();
        }}
      />
    </section>
  );
}
