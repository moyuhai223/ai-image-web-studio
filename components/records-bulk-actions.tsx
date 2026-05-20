"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Tags, Trash2 } from "lucide-react";
import { DangerConfirmDialog } from "./danger-confirm-dialog";

export const RECORDS_BULK_FORM_ID = "records-bulk-form";

type BulkResponse = {
  error?: string;
  deleted?: number;
  blocked?: number;
  missing?: number;
  failed?: number;
  jobCount?: number;
  imageCount?: number;
  tags?: string[];
};

type RecordsSelectionContextValue = {
  ids: string[];
  selectedIds: Set<string>;
  selectedCount: number;
  allSelected: boolean;
  loading: boolean;
  setLoading: (loading: boolean) => void;
  toggleId: (id: string, checked: boolean) => void;
  togglePage: (checked: boolean) => void;
  clearSelection: () => void;
};

const RecordsSelectionContext = createContext<RecordsSelectionContextValue | null>(null);

function useRecordsSelection() {
  const context = useContext(RecordsSelectionContext);
  if (!context) {
    throw new Error("Records selection context is missing");
  }
  return context;
}

export function RecordsSelectionProvider({ ids, children }: { ids: string[]; children: ReactNode }) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setSelectedIds((current) => {
      const visible = new Set(ids);
      const next = new Set(Array.from(current).filter((id) => visible.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [ids]);

  const value = useMemo<RecordsSelectionContextValue>(() => {
    const selectedCount = selectedIds.size;
    return {
      ids,
      selectedIds,
      selectedCount,
      allSelected: ids.length > 0 && selectedCount === ids.length,
      loading,
      setLoading,
      toggleId(id, checked) {
        setSelectedIds((current) => {
          const next = new Set(current);
          if (checked) {
            next.add(id);
          } else {
            next.delete(id);
          }
          return next;
        });
      },
      togglePage(checked) {
        setSelectedIds(checked ? new Set(ids) : new Set());
      },
      clearSelection() {
        setSelectedIds(new Set());
      }
    };
  }, [ids, loading, selectedIds]);

  return <RecordsSelectionContext.Provider value={value}>{children}</RecordsSelectionContext.Provider>;
}

export function RecordSelectCheckbox({ id }: { id: string }) {
  const { loading, selectedIds, toggleId } = useRecordsSelection();

  return (
    <label className="record-select-control" aria-label="选择记录">
      <input
        data-record-select
        type="checkbox"
        checked={selectedIds.has(id)}
        disabled={loading}
        onChange={(event) => toggleId(id, event.target.checked)}
      />
    </label>
  );
}

export function RecordsBulkActions() {
  const router = useRouter();
  const { ids, selectedIds, selectedCount, allSelected, loading, setLoading, togglePage, clearSelection } = useRecordsSelection();
  const [tags, setTags] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  function selectedIdList() {
    return Array.from(selectedIds);
  }

  useEffect(() => {
    setError("");
  }, [selectedCount]);

  async function runBulk(action: "delete" | "add_tags") {
    const ids = selectedIdList();
    setError("");
    setMessage("");
    if (ids.length === 0) {
      setError("请先选择记录");
      return;
    }

    setLoading(true);
    const response = await fetch("/api/records/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, ids, tags: tags.split(/[，,\n]/).map((item) => item.trim()).filter(Boolean) })
    });
    const data = (await response.json().catch(() => ({}))) as BulkResponse;
    setLoading(false);

    if (!response.ok && response.status !== 207) {
      setError(data.error ?? "批量操作失败");
      return;
    }

    if (action === "delete") {
      setConfirmDeleteOpen(false);
      setMessage(`批量删除完成：已删除 ${data.deleted ?? 0} 条，运行中阻止 ${data.blocked ?? 0} 条，失败 ${data.failed ?? 0} 条。`);
      clearSelection();
      router.refresh();
      return;
    }

    setMessage(`已为 ${data.jobCount ?? 0} 条记录、${data.imageCount ?? 0} 张图片添加标签。`);
    setTags("");
    router.refresh();
  }

  function closeDeleteConfirm() {
    if (loading) return;
    setConfirmDeleteOpen(false);
    setError("");
  }

  return (
    <>
      <details className="record-tool-panel records-bulk-panel">
        <summary>
          <span>
            <Tags size={14} />
            标签
          </span>
          <span className="record-filter-summary-meta">已选 {selectedCount}</span>
        </summary>
        <form id={RECORDS_BULK_FORM_ID} className="records-bulk-bar" onSubmit={(event) => event.preventDefault()}>
          <div className="records-bulk-main">
            <label className="toggle-field records-bulk-select-all">
              <input
                type="checkbox"
                checked={allSelected}
                disabled={ids.length === 0 || loading}
                onChange={(event) => togglePage(event.target.checked)}
              />
              <span>本页全选</span>
            </label>
            <span className="status">已选 {selectedCount}</span>
            {message ? <span className="small muted">{message}</span> : null}
            {error ? <span className="small failed-text">{error}</span> : null}
          </div>
          <div className="records-bulk-actions">
            <input
              className="input"
              value={tags}
              disabled={loading}
              placeholder="批量添加标签，逗号分隔"
              onChange={(event) => setTags(event.target.value)}
            />
            <button
              className="button secondary"
              type="button"
              disabled={loading || selectedCount === 0 || !tags.trim()}
              onClick={() => {
                void runBulk("add_tags");
              }}
            >
              <Tags size={16} />
              加标签
            </button>
            <button
              className="button danger"
              type="button"
              disabled={loading || selectedCount === 0}
              onClick={() => setConfirmDeleteOpen(true)}
            >
              <Trash2 size={16} />
              批量删除
            </button>
          </div>
        </form>
      </details>
      <DangerConfirmDialog
        open={confirmDeleteOpen}
        title="确认批量删除"
        description={`会删除所选 ${selectedCount} 条记录及其本地生成图片。排队或运行中的任务会被自动跳过。`}
        confirmLabel="批量删除"
        loadingLabel="删除中"
        loading={loading}
        error={error}
        onClose={closeDeleteConfirm}
        onConfirm={() => {
          void runBulk("delete");
        }}
      />
    </>
  );
}
