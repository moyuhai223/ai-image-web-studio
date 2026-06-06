import { config } from "@/lib/config";
import { APP_VERSION_LABEL } from "@/lib/version";

// 全站页脚:项目名 · GitHub · 版本。放在每个 .shell 内,随主题变色。
// 服务端组件:直接读 config 拿 GitHub 仓库,读 APP_VERSION_LABEL 拿版本,无需 props。
export function AppFooter() {
  const repoUrl = `https://github.com/${config.githubRepositorySlug}`;
  return (
    <footer className="app-footer">
      <span className="app-footer-brand">AI Image Studio</span>
      <span className="app-footer-dot" aria-hidden="true">·</span>
      <a className="app-footer-link" href={repoUrl} target="_blank" rel="noreferrer">
        GitHub
      </a>
      <span className="app-footer-dot" aria-hidden="true">·</span>
      <span className="app-footer-version">{APP_VERSION_LABEL}</span>
    </footer>
  );
}
