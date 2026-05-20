import { Activity, AlertTriangle, CheckCircle2, Database, HardDrive, KeyRound, LinkIcon } from "lucide-react";
import type { SystemHealth } from "@/lib/health";
import { formatDateTime } from "@/lib/time";

function checkStatus(ok: boolean) {
  return ok ? "正常" : "异常";
}

function CheckBadge({ ok }: { ok: boolean }) {
  return <span className={`status ${ok ? "succeeded" : "failed"}`}>{checkStatus(ok)}</span>;
}

export function SystemHealthCard({ health }: { health: SystemHealth }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="small muted" style={{ margin: "0 0 4px" }}>系统状态</p>
          <h1 className="panel-title">健康检查</h1>
        </div>
        <CheckBadge ok={health.ok} />
      </div>
      <div className="panel-body form-stack">
        <div className="health-summary">
          <div className="health-metric">
            <Activity size={18} />
            <div>
              <strong>{health.version.label}</strong>
              <p className="small muted">当前版本</p>
            </div>
          </div>
          <div className="health-metric">
            <KeyRound size={18} />
            <div>
              <strong>{health.keys.enabled} / {health.keys.total}</strong>
              <p className="small muted">启用 Key / 总 Key</p>
            </div>
          </div>
          <div className="health-metric">
            <LinkIcon size={18} />
            <div>
              <strong className="break-text">{health.provider.baseUrl}</strong>
              <p className="small muted">Provider Base URL · {health.provider.source === "database" ? "设置页" : ".env"}</p>
            </div>
          </div>
        </div>

        <div className="health-grid">
          <article className="health-check">
            <div className="health-check-head">
              <span><Database size={16} /> 数据库</span>
              <CheckBadge ok={health.database.ok} />
            </div>
            {health.database.error ? <p className="small health-error">{health.database.error}</p> : <p className="small muted">连接正常</p>}
          </article>

          <article className="health-check">
            <div className="health-check-head">
              <span><HardDrive size={16} /> 存储目录</span>
              <CheckBadge ok={health.storage.ok} />
            </div>
            <p className="small muted break-text">{health.storage.path}</p>
            {health.storage.error ? <p className="small health-error">{health.storage.error}</p> : null}
          </article>

          <article className="health-check">
            <div className="health-check-head">
              <span><KeyRound size={16} /> Key 池</span>
              <CheckBadge ok={!health.keys.error} />
            </div>
            <p className="small muted">总数 {health.keys.total}，启用 {health.keys.enabled}，停用 {health.keys.disabled}</p>
            {health.keys.error ? <p className="small health-error">{health.keys.error}</p> : null}
          </article>

          <article className="health-check">
            <div className="health-check-head">
              <span><AlertTriangle size={16} /> 最近生成错误</span>
              <span className="status">{health.lastGenerationError ? "有记录" : "无"}</span>
            </div>
            {health.lastGenerationError ? (
              <>
                <p className="small muted">{health.lastGenerationError.model} · {formatDateTime(health.lastGenerationError.updatedAt)}</p>
                <p className="small health-error">{health.lastGenerationError.message}</p>
              </>
            ) : (
              <p className="small muted">暂未记录失败任务</p>
            )}
          </article>
        </div>

        <p className="small muted">
          <CheckCircle2 size={13} style={{ verticalAlign: "-2px" }} /> 最近检查：{formatDateTime(health.checkedAt)}
        </p>
      </div>
    </section>
  );
}
