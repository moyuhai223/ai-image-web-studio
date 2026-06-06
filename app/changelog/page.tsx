import { readFile } from "node:fs/promises";
import path from "node:path";
import { AppNav } from "@/components/app-nav";
import { AppFooter } from "@/components/app-footer";
import { requireUser } from "@/lib/auth";
import { getUiThemePreference } from "@/lib/ui-theme";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

// 轻量行内 markdown:`代码`、**加粗**、[文字](链接)。不引依赖,够 CHANGELOG 用。
function renderInline(text: string) {
  return text
    .split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g)
    .map((part, index) => {
      if (!part) return null;
      if (part.startsWith("`") && part.endsWith("`")) {
        return <code key={index}>{part.slice(1, -1)}</code>;
      }
      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={index}>{part.slice(2, -2)}</strong>;
      }
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
      if (link) {
        return (
          <a key={index} href={link[2]} target="_blank" rel="noreferrer">
            {link[1]}
          </a>
        );
      }
      return part;
    });
}

type ChangelogItem = { content: ReactNode; subs: ReactNode[] };

function renderChangelog(content: string) {
  const nodes: ReactNode[] = [];
  let list: ChangelogItem[] | null = null;

  function flushList() {
    if (!list || list.length === 0) {
      list = null;
      return;
    }
    nodes.push(
      <ul key={`ul-${nodes.length}`}>
        {list.map((item, i) => (
          <li key={i}>
            {item.content}
            {item.subs.length > 0 ? (
              <ul>
                {item.subs.map((sub, j) => (
                  <li key={j}>{sub}</li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    );
    list = null;
  }

  content.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      return;
    }

    if (trimmed === "# 更新日志") return;

    if (trimmed.startsWith("- ")) {
      // 缩进 ≥2 空格的视为上一条的二级子项,渲染成嵌套列表。
      const indent = line.length - line.trimStart().length;
      const item = renderInline(trimmed.slice(2));
      if (!list) list = [];
      if (indent >= 2 && list.length > 0) {
        list[list.length - 1].subs.push(item);
      } else {
        list.push({ content: item, subs: [] });
      }
      return;
    }

    flushList();

    if (trimmed.startsWith("## ")) {
      nodes.push(<h2 key={index}>{renderInline(trimmed.slice(3))}</h2>);
    } else if (trimmed.startsWith("### ")) {
      nodes.push(<h3 key={index}>{renderInline(trimmed.slice(4))}</h3>);
    } else {
      nodes.push(<p key={index}>{renderInline(trimmed)}</p>);
    }
  });

  flushList();
  return nodes;
}

async function loadChangelog() {
  return readFile(path.join(process.cwd(), "CHANGELOG.md"), "utf8");
}

export default async function ChangelogPage() {
  const user = await requireUser();
  const [content, themePreference] = await Promise.all([loadChangelog(), getUiThemePreference()]);

  return (
    <div className="shell" data-theme={themePreference.theme}>
      <AppNav user={user} themeMode={themePreference.mode} />
      <main className="main">
        <section className="panel">
          <div className="panel-header">
            <h1 className="panel-title">更新日志</h1>
            <span className="status">CHANGELOG.md</span>
          </div>
          <article className="panel-body changelog-body">
            {renderChangelog(content)}
          </article>
        </section>
      </main>
      <AppFooter />
    </div>
  );
}
