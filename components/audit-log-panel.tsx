"use client";

import { useEffect, useState } from "react";
import { FileClock, RefreshCw } from "lucide-react";
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
  error?: string;
};

function detailText(detail: Record<string, unknown>) {
  const entries = Object.entries(detail).filter(([, value]) => value !== undefined && value !== null && value !== "");
  if (entries.length === 0) return "无详情";
  return entries.map(([key, value]) => `${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`).join(" · ");
}

export function AuditLogPanel() {
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function loadLogs() {
    setLoading(true);
    setMessage("");
    const response = await fetch("/api/audit-logs?limit=100", { cache: "no-store" });
    const data = (await response.json().catch(() => ({}))) as AuditLogResponse;
    setLoading(false);

    if (!response.ok || !Array.isArray(data.logs)) {
      setMessage(data.error ?? "审计日志加载失败");
      return;
    }

    setLogs(data.logs);
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
        <button className="status" type="button" onClick={loadLogs} disabled={loading}>
          <RefreshCw size={13} />
          {loading ? "加载中" : "刷新"}
        </button>
      </div>
      <div className="panel-body form-stack">
        <p className="small muted">记录管理员和批量记录操作，便于回看谁在什么时候改了关键数据。</p>
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
    </section>
  );
}
