"use client";

import { Search, Tags } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { useRecordsSelection } from "./records-bulk-actions";

type ActivePanel = "search" | "tags" | null;

type RecordsToolPanelsProps = {
  searchSummary: string;
  initialActive?: ActivePanel;
  search: ReactNode;
  tags: ReactNode;
};

export function RecordsToolPanels({ searchSummary, initialActive = null, search, tags }: RecordsToolPanelsProps) {
  const [active, setActive] = useState<ActivePanel>(initialActive);
  const { selectedCount } = useRecordsSelection();

  function toggle(next: Exclude<ActivePanel, null>) {
    setActive((current) => (current === next ? null : next));
  }

  return (
    <div className="record-tool-row" data-active-panel={active ?? "none"}>
      <button
        className={`record-tool-tab${active === "search" ? " active" : ""}`}
        type="button"
        aria-expanded={active === "search"}
        onClick={() => toggle("search")}
      >
        <span>
          <Search size={14} />
          搜索
        </span>
        <span className="record-filter-summary-meta">{searchSummary}</span>
      </button>
      <button
        className={`record-tool-tab${active === "tags" ? " active" : ""}`}
        type="button"
        aria-expanded={active === "tags"}
        onClick={() => toggle("tags")}
      >
        <span>
          <Tags size={14} />
          标签
        </span>
        <span className="record-filter-summary-meta">已选 {selectedCount}</span>
      </button>
      {active === "search" ? <div className="record-tool-panel record-tool-content">{search}</div> : null}
      {active === "tags" ? <div className="record-tool-panel record-tool-content">{tags}</div> : null}
    </div>
  );
}
