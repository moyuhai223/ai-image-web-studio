import { readFile } from "node:fs/promises";
import path from "node:path";
import { AppNav } from "@/components/app-nav";
import { requireUser } from "@/lib/auth";
import { getUiThemePreference } from "@/lib/ui-theme";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

function renderInline(text: string) {
  return text.split(/(`[^`]+`)/g).map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    return part;
  });
}

function renderChangelog(content: string) {
  const nodes: ReactNode[] = [];
  let listItems: ReactNode[] = [];

  function flushList() {
    if (listItems.length === 0) return;
    nodes.push(<ul key={`ul-${nodes.length}`}>{listItems}</ul>);
    listItems = [];
  }

  content.split(/\r?\n/).forEach((line, index) => {
    const text = line.trim();
    if (!text) {
      flushList();
      return;
    }

    if (text === "# 更新日志") return;

    if (text.startsWith("- ")) {
      listItems.push(<li key={`li-${index}`}>{renderInline(text.slice(2))}</li>);
      return;
    }

    flushList();

    if (text.startsWith("## ")) {
      nodes.push(<h2 key={index}>{renderInline(text.slice(3))}</h2>);
    } else if (text.startsWith("### ")) {
      nodes.push(<h3 key={index}>{renderInline(text.slice(4))}</h3>);
    } else {
      nodes.push(<p key={index}>{renderInline(text)}</p>);
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
    </div>
  );
}
