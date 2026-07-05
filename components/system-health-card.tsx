import { Activity, AlertTriangle, CheckCircle2, Database, Gauge, HardDrive, KeyRound, LinkIcon, Timer } from "lucide-react";
import type { SystemHealth } from "@/lib/health";
import type { OperationalMetrics, PhaseTimingQuantiles } from "@/lib/metrics";
import { generationStatusLabel } from "@/lib/generation-status";
import { formatDateTime } from "@/lib/time";

function checkStatus(ok: boolean) {
  return ok ? "正常" : "异常";
}

function CheckBadge({ ok }: { ok: boolean }) {
  return <span className={`status ${ok ? "succeeded" : "failed"}`}>{checkStatus(ok)}</span>;
}

function formatRate(rate: number | null): string {
  if (rate === null) return "—";
  return `${(rate * 100).toFixed(1)}%`;
}

function formatMs(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (value >= 1000) return `${(value / 1000).toFixed(2)}s`;
  return `${Math.round(value)}ms`;
}

function PhaseRow({ label, timing }: { label: string; timing: PhaseTimingQuantiles }) {
  return (
    <li className="key-row">
      <div className="key-meta">
        <strong>{label}</strong>
        <span className="small muted">样本 <span className="num">{timing.count}</span></span>
      </div>
      <div className="actions">
        <span className="status">p50 <span className="num">{formatMs(timing.p50)}</span></span>
        <span className="status">p95 <span className="num">{formatMs(timing.p95)}</span></span>
      </div>
    </li>
  );
}

export function SystemHealthCard({ health, metrics }: { health: SystemHealth; metrics?: OperationalMetrics | null }) {
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
              <strong className="num">{health.version.label}</strong>
              <p className="small muted">当前版本</p>
            </div>
          </div>
          <div className="health-metric">
            <KeyRound size={18} />
            <div>
              <strong className="num">{health.keys.enabled} / {health.keys.total}</strong>
              <p className="small muted">可用模型组 / 总组</p>
            </div>
          </div>
          <div className="health-metric">
            <LinkIcon size={18} />
            <div>
              <strong className="break-text">{health.provider.baseUrl || "未配置"}</strong>
              <p className="small muted">
                默认组 · {health.provider.source === "database" ? "模型组" : ".env 兜底"}
                {health.provider.groups.length > 0 ? <> · 共 <span className="num">{health.provider.groups.length}</span> 组</> : ""}
              </p>
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
              <span><KeyRound size={16} /> 模型组</span>
              <CheckBadge ok={!health.keys.error} />
            </div>
            <p className="small muted">共 <span className="num">{health.keys.total}</span> 组，可用 <span className="num">{health.keys.enabled}</span>，不可用 <span className="num">{health.keys.disabled}</span></p>
            {health.keys.error ? <p className="small health-error">{health.keys.error}</p> : null}
          </article>

          <article className="health-check">
            <div className="health-check-head">
              <span><AlertTriangle size={16} /> 最近生成错误</span>
              <span className="status">
                {health.lastGenerationError
                  ? generationStatusLabel(health.lastGenerationError.status)
                  : "无"}
              </span>
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

        {health.provider.groups.length > 0 ? (
          <div className="form-stack">
            <p className="small muted">模型组</p>
            <ul className="key-list" style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {health.provider.groups.map((group) => (
                <li key={group.id} className="key-row">
                  <div className="key-meta">
                    <div className="actions">
                      <strong>{group.name}</strong>
                      {group.isDefault ? <span className="status succeeded">默认</span> : null}
                      {!group.enabled ? <span className="status failed">停用</span> : null}
                      {!group.hasKey ? <span className="status failed">无 Key</span> : null}
                    </div>
                    <span className="small muted break-text">{group.baseUrl} · {group.models} 个模型</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {metrics ? (
          <div className="form-stack">
            <p className="small muted">
              <Gauge size={13} style={{ verticalAlign: "-2px" }} /> 性能指标
              <span className="small muted" style={{ marginLeft: 8 }}>
                · 数据窗口：最近 24 小时
              </span>
            </p>
            <div className="health-grid">
              <article className="health-check">
                <div className="health-check-head">
                  <span><Activity size={16} /> 队列深度</span>
                  <span className="status"><span className="num">{metrics.queueDepth.queued + metrics.queueDepth.running}</span> 项</span>
                </div>
                <p className="small muted">
                  排队 <span className="num">{metrics.queueDepth.queued}</span> · 执行中 <span className="num">{metrics.queueDepth.running}</span>
                </p>
              </article>

              <article className="health-check">
                <div className="health-check-head">
                  <span><CheckCircle2 size={16} /> 成功率</span>
                  <span className="status succeeded"><span className="num">{formatRate(metrics.successRate24h.rate)}</span></span>
                </div>
                <p className="small muted">
                  24h: <span className="num">{metrics.successRate24h.succeeded}/{metrics.successRate24h.terminal}</span> ·
                  1h: <span className="num">{formatRate(metrics.successRate1h.rate)}</span>(<span className="num">{metrics.successRate1h.succeeded}/{metrics.successRate1h.terminal}</span>)
                </p>
              </article>

              <article className="health-check">
                <div className="health-check-head">
                  <span><KeyRound size={16} /> 模型组</span>
                  <span className="status"><span className="num">{metrics.aiKeys.enabled}</span> / {metrics.aiKeys.total} 可用</span>
                </div>
                <p className="small muted">可用 = 已启用且已配置 Key 的组</p>
              </article>

              <article className="health-check">
                <div className="health-check-head">
                  <span><Activity size={16} /> 24h 任务分布</span>
                  <span className="status"><span className="num">{metrics.recentJobs24h.total}</span> 项</span>
                </div>
                <p className="small muted">
                  成功 <span className="num">{metrics.recentJobs24h.byStatus.succeeded ?? 0}</span> · 失败 <span className="num">{metrics.recentJobs24h.byStatus.failed ?? 0}</span>
                  {metrics.recentJobs24h.byStatus.upstream_error
                    ? <> · 上游错误 <span className="num">{metrics.recentJobs24h.byStatus.upstream_error}</span></>
                    : ""}
                  {metrics.recentJobs24h.byStatus.interrupted
                    ? <> · 中断 <span className="num">{metrics.recentJobs24h.byStatus.interrupted}</span></>
                    : ""}
                  {metrics.recentJobs24h.byStatus.canceled
                    ? <> · 取消 <span className="num">{metrics.recentJobs24h.byStatus.canceled}</span></>
                    : ""}
                </p>
              </article>
            </div>

            <div className="form-stack">
              <p className="small muted">
                <Timer size={13} style={{ verticalAlign: "-2px" }} /> 阶段耗时 p50 / p95(成功任务)
              </p>
              <ul className="key-list" style={{ listStyle: "none", padding: 0, margin: 0 }}>
                <PhaseRow label="模型等待" timing={metrics.phaseTimingsMs.upstream_wait} />
                <PhaseRow label="下载 / 解码" timing={metrics.phaseTimingsMs.download_decode} />
                <PhaseRow label="入库" timing={metrics.phaseTimingsMs.db_insert} />
              </ul>
              <p className="small muted">
                Prometheus 抓取地址：<code>/api/health/metrics?format=prometheus</code>
              </p>
            </div>
          </div>
        ) : null}

        <p className="small muted">
          <CheckCircle2 size={13} style={{ verticalAlign: "-2px" }} /> 最近检查：{formatDateTime(health.checkedAt)}
        </p>
      </div>
    </section>
  );
}
