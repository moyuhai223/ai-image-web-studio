"use client";

import { useState } from "react";
import { Download, ExternalLink, GitPullRequest, RefreshCw, Tag } from "lucide-react";
import { formatDateTime } from "@/lib/time";

type ReleaseAsset = {
  name: string;
  url: string;
  size: number;
};

type UpdateCheckResult = {
  repository: string;
  repositoryUrl: string;
  currentVersion: string;
  latestVersion: string | null;
  latestTag: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
  publishedAt: string | null;
  notes: string;
  assets: ReleaseAsset[];
  checkedAt: string;
  error: string | null;
};

type Props = {
  currentVersion: string;
  repository: string;
};

function formatSize(value: number) {
  if (!value) return "";
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function UpdateCheckPanel({ currentVersion, repository }: Props) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<UpdateCheckResult | null>(null);
  const [error, setError] = useState("");

  async function checkUpdates() {
    setLoading(true);
    setError("");
    const response = await fetch("/api/update-check", { cache: "no-store" });
    const data = (await response.json().catch(() => ({}))) as Partial<UpdateCheckResult>;
    setLoading(false);

    if (!response.ok || data.error) {
      setResult(null);
      setError(data.error ?? "检查更新失败");
      return;
    }

    setResult(data as UpdateCheckResult);
  }

  const latestVersion = result?.latestVersion ?? null;
  const updateAvailable = Boolean(result?.updateAvailable);

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 className="panel-title">
          <GitPullRequest size={17} /> 版本更新
        </h2>
        <span className={`status ${updateAvailable ? "running" : "succeeded"}`}>
          {latestVersion ? (updateAvailable ? "有新版本" : "已是最新") : "待检查"}
        </span>
      </div>
      <div className="panel-body form-stack">
        <div className="health-summary">
          <div className="health-metric">
            <Tag size={18} />
            <div>
              <strong>v{currentVersion}</strong>
              <p className="small muted">当前版本</p>
            </div>
          </div>
          <div className="health-metric">
            <Tag size={18} />
            <div>
              <strong>{latestVersion ? `v${latestVersion}` : "未检查"}</strong>
              <p className="small muted">GitHub 最新 Release</p>
            </div>
          </div>
        </div>

        <div className="actions">
          <button className="button action-button action-refresh" type="button" onClick={checkUpdates} disabled={loading}>
            <RefreshCw size={16} />
            {loading ? "检查中" : "检查更新"}
          </button>
          <a className="button action-button action-detail" href={`https://github.com/${repository}/releases`} target="_blank" rel="noreferrer">
            <ExternalLink size={16} />
            Release 页面
          </a>
        </div>

        {error ? <p className="small health-error">{error}</p> : null}

        {result ? (
          <div className="health-grid">
            <article className="health-check">
              <div className="health-check-head">
                <span>更新状态</span>
                <span className={`status ${updateAvailable ? "running" : "succeeded"}`}>
                  {updateAvailable ? "可更新" : "无需更新"}
                </span>
              </div>
              <p className="small muted">
                检查时间：{formatDateTime(result.checkedAt)}
                {result.publishedAt ? ` · 发布时间：${formatDateTime(result.publishedAt)}` : ""}
              </p>
              {result.releaseUrl ? (
                <a className="small" href={result.releaseUrl} target="_blank" rel="noreferrer">
                  查看 {result.latestTag} 更新说明
                </a>
              ) : null}
            </article>

            <article className="health-check">
              <div className="health-check-head">
                <span>服务器更新命令</span>
              </div>
              <pre className="code-block">git pull{"\n"}docker compose up -d --build</pre>
              <p className="small muted">1Panel 本地应用可下载 Release 附件里的 zip 后手动导入更新。</p>
            </article>

            {result.assets.length > 0 ? (
              <article className="health-check">
                <div className="health-check-head">
                  <span>Release 附件</span>
                </div>
                <div className="form-stack">
                  {result.assets.map((asset) => (
                    <a className="button action-button action-download" href={asset.url} key={asset.name} target="_blank" rel="noreferrer">
                      <Download size={16} />
                      {asset.name}
                      {asset.size ? <span className="small muted">{formatSize(asset.size)}</span> : null}
                    </a>
                  ))}
                </div>
              </article>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
