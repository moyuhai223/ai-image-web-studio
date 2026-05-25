"use client";

/**
 * /records 页头部工具条:把 "搜索 / 标签" 两个 tab 上提到 .panel-header 同一行,
 * 展开后的面板仍在 .panel-body 内,占满整行。
 *
 * 三件套:
 *   <RecordsToolPanelsProvider> — 包住整个 .panel,提供 active state + summary 文案
 *   <RecordsToolTabs />          — tab 按钮组(放进 .panel-header .actions)
 *                                   宽屏:图标 + 文字 + 计数胶囊
 *                                   窄屏:图标 + 计数胶囊(label 隐藏,见 globals.css 容器查询)
 *   <RecordsToolContent search tags /> — 展开内容(放进 .panel-body 顶部)
 *
 * 旧的 <RecordsToolPanels> 单组件用法已废弃。
 */

import { Search, Tags } from "lucide-react";
import type { ReactNode } from "react";
import { createContext, useContext, useState } from "react";
import { useRecordsSelection } from "./records-bulk-actions";

type ActivePanel = "search" | "tags" | null;

type RecordsToolContextValue = {
  active: ActivePanel;
  toggle: (next: Exclude<ActivePanel, null>) => void;
  searchSummary: string;
};

const RecordsToolContext = createContext<RecordsToolContextValue | null>(null);

function useRecordsToolContext() {
  const ctx = useContext(RecordsToolContext);
  if (!ctx) {
    throw new Error("RecordsToolTabs/Content 必须放在 <RecordsToolPanelsProvider> 里");
  }
  return ctx;
}

export function RecordsToolPanelsProvider({
  searchSummary,
  initialActive = null,
  children
}: {
  searchSummary: string;
  initialActive?: ActivePanel;
  children: ReactNode;
}) {
  const [active, setActive] = useState<ActivePanel>(initialActive);
  return (
    <RecordsToolContext.Provider
      value={{
        active,
        searchSummary,
        toggle: (next) => setActive((current) => (current === next ? null : next))
      }}
    >
      {children}
    </RecordsToolContext.Provider>
  );
}

export function RecordsToolTabs() {
  const { active, toggle, searchSummary } = useRecordsToolContext();
  const { selectedCount } = useRecordsSelection();
  // 默认无筛选时不显示 badge(避免出现 "展开选项" 这种占位文案)
  const hasSearchBadge = searchSummary.length > 0;
  const hasTagBadge = selectedCount > 0;
  const searchTitle = hasSearchBadge ? `搜索 · ${searchSummary}` : "搜索";
  const tagsTitle = hasTagBadge ? `标签 · 已选 ${selectedCount}` : "标签";

  return (
    <div className="record-tool-tabs" role="group" aria-label="筛选与标签工具">
      <button
        className={`record-tool-tab${active === "search" ? " active" : ""}`}
        type="button"
        aria-expanded={active === "search"}
        aria-label={searchTitle}
        title={searchTitle}
        onClick={() => toggle("search")}
      >
        <Search size={14} aria-hidden />
        <span className="record-tool-tab-label">搜索</span>
        {hasSearchBadge ? <span className="record-tool-tab-badge num">{searchSummary}</span> : null}
      </button>
      <button
        className={`record-tool-tab${active === "tags" ? " active" : ""}`}
        type="button"
        aria-expanded={active === "tags"}
        aria-label={tagsTitle}
        title={tagsTitle}
        onClick={() => toggle("tags")}
      >
        <Tags size={14} aria-hidden />
        <span className="record-tool-tab-label">标签</span>
        {hasTagBadge ? <span className="record-tool-tab-badge num">{selectedCount}</span> : null}
      </button>
    </div>
  );
}

export function RecordsToolContent({ search, tags }: { search: ReactNode; tags: ReactNode }) {
  const { active } = useRecordsToolContext();
  if (!active) return null;
  return (
    <div className="record-tool-content" role="region" aria-label={active === "search" ? "搜索面板" : "标签面板"}>
      {active === "search" ? search : tags}
    </div>
  );
}
