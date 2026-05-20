import { config } from "./config";
import { APP_VERSION } from "./version";

export type ReleaseAsset = {
  name: string;
  url: string;
  size: number;
};

export type UpdateCheckResult = {
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

type GitHubRelease = {
  tag_name?: string;
  html_url?: string;
  body?: string;
  published_at?: string;
  assets?: Array<{
    name?: string;
    browser_download_url?: string;
    size?: number;
  }>;
  message?: string;
};

function normalizeVersion(value: string) {
  return value.trim().replace(/^v/i, "");
}

function compareVersions(left: string, right: string) {
  const a = normalizeVersion(left).split(".").map((part) => Number(part) || 0);
  const b = normalizeVersion(right).split(".").map((part) => Number(part) || 0);
  const length = Math.max(a.length, b.length);

  for (let index = 0; index < length; index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) return diff;
  }

  return 0;
}

function repositoryUrl() {
  return `https://github.com/${config.githubRepositorySlug}`;
}

export async function checkForUpdates(): Promise<UpdateCheckResult> {
  const checkedAt = new Date().toISOString();
  const repository = config.githubRepositorySlug;
  const base = {
    repository,
    repositoryUrl: repositoryUrl(),
    currentVersion: APP_VERSION,
    latestVersion: null,
    latestTag: null,
    updateAvailable: false,
    releaseUrl: null,
    publishedAt: null,
    notes: "",
    assets: [],
    checkedAt
  };

  try {
    const response = await fetch(`https://api.github.com/repos/${repository}/releases/latest`, {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "ai-image-web-studio-update-check"
      },
      cache: "no-store"
    });
    const data = (await response.json().catch(() => ({}))) as GitHubRelease;

    if (!response.ok) {
      return {
        ...base,
        error: data.message ?? `GitHub Release 检查失败：${response.status}`
      };
    }

    const latestTag = typeof data.tag_name === "string" ? data.tag_name : null;
    const latestVersion = latestTag ? normalizeVersion(latestTag) : null;
    const assets = Array.isArray(data.assets)
      ? data.assets
          .filter((item) => typeof item.name === "string" && typeof item.browser_download_url === "string")
          .map((item) => ({
            name: item.name as string,
            url: item.browser_download_url as string,
            size: typeof item.size === "number" ? item.size : 0
          }))
      : [];

    return {
      ...base,
      latestVersion,
      latestTag,
      updateAvailable: latestVersion ? compareVersions(latestVersion, APP_VERSION) > 0 : false,
      releaseUrl: typeof data.html_url === "string" ? data.html_url : null,
      publishedAt: typeof data.published_at === "string" ? data.published_at : null,
      notes: typeof data.body === "string" ? data.body : "",
      assets,
      error: null
    };
  } catch (error) {
    return {
      ...base,
      error: error instanceof Error ? error.message : "检查更新失败"
    };
  }
}
