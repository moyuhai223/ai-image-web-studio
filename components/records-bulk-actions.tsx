"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Download, Images, Tags, Trash2 } from "lucide-react";
import { DangerConfirmDialog } from "./danger-confirm-dialog";
import { downloadImagesZip, downloadOriginalImages } from "./download-zip";
import { RecordsToolTabs, useRecordsToolPanel } from "./records-tool-panels";

export const RECORDS_BULK_FORM_ID = "records-bulk-form";

type BulkResponse = {
  error?: string;
  deleted?: number;
  blocked?: number;
  missing?: number;
  failed?: number;
  errored?: number;
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

export function useRecordsSelection() {
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
  const selected = selectedIds.has(id);

  return (
    <label className={`record-select-control${selected ? " selected" : ""}`} aria-label={selected ? "取消选择记录" : "选择记录"}>
      <input
        data-record-select
        type="checkbox"
        checked={selected}
        disabled={loading}
        onChange={(event) => toggleId(id, event.target.checked)}
      />
    </label>
  );
}

export function RecordsBulkActions() {
  const router = useRouter();
  const { ids, selectedIds, selectedCount, allSelected, loading, setLoading, toggleId, togglePage, clearSelection } = useRecordsSelection();
  const [tags, setTags] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  function selectedIdList() {
    return Array.from(selectedIds);
  }

  function clearSingle(id: string) {
    toggleId(id, false);
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
      // v0.6.1: errored 是单条 throw 异常的数量,与 failed(逻辑判定失败)区分
      const erroredCount = data.errored ?? 0;
      const erroredSuffix = erroredCount > 0 ? `，异常 ${erroredCount} 条` : "";
      setMessage(`批量删除完成：已删除 ${data.deleted ?? 0} 条，运行中阻止 ${data.blocked ?? 0} 条，失败 ${data.failed ?? 0} 条${erroredSuffix}。`);
      clearSelection();
      router.refresh();
      return;
    }

    setMessage(`已为 ${data.jobCount ?? 0} 条记录、${data.imageCount ?? 0} 张图片添加标签。`);
    setTags("");
    router.refresh();
  }

  async function runDownload() {
    const list = selectedIdList();
    setError("");
    setMessage("");
    if (list.length === 0) {
      setError("请先选择记录");
      return;
    }
    setLoading(true);
    const result = await downloadImagesZip({ jobIds: list });
    setLoading(false);
    if (!result.ok) {
      setError(result.error ?? "下载失败");
      return;
    }
    setMessage(
      result.truncated
        ? `所选图片超过 200 张,已打包前 200 张(其余请分批下载)。`
        : `已开始下载所选 ${list.length} 条记录的图片 ZIP。`
    );
  }

  async function runDownloadOriginals() {
    const list = selectedIdList();
    setError("");
    setMessage("");
    if (list.length === 0) {
      setError("请先选择记录");
      return;
    }
    setLoading(true);
    const result = await downloadOriginalImages({ jobIds: list });
    setLoading(false);
    if (!result.ok) {
      setError(result.error ?? "下载失败");
      return;
    }
    setMessage(
      `已开始逐张下载 ${result.count ?? 0} 张原图(浏览器若提示允许多文件下载,请允许)。${result.truncated ? "所选超过 200 张,本次只下载前 200 张。" : ""}`
    );
  }

  function closeDeleteConfirm() {
    if (loading) return;
    setConfirmDeleteOpen(false);
    setError("");
  }

  return (
    <>
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
          {selectedCount > 0 ? (
            <button className="status" type="button" disabled={loading} onClick={clearSelection}>
              清空选择
            </button>
          ) : null}
          {message ? <span className="small muted">{message}</span> : null}
          {error ? <span className="small failed-text">{error}</span> : null}
        </div>
        {selectedCount > 0 ? (
          <div className="records-selected-list" aria-label="已选择记录">
            {Array.from(selectedIds).map((id) => (
              <button className="record-selected-chip" type="button" key={id} disabled={loading} onClick={() => clearSingle(id)}>
                {id.slice(0, 8)}
                <span aria-hidden="true">×</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="small muted records-selected-empty">勾选图片卡片左上角选择框，或点击本页全选后再取消不需要的记录。</p>
        )}
        <div className="records-bulk-actions">
          <button
            className="status action-button action-download"
            type="button"
            disabled={loading || selectedCount === 0}
            onClick={() => {
              void runDownload();
            }}
          >
            <Download size={13} aria-hidden />
            下载 ZIP
          </button>
          <button
            className="status action-button action-download"
            type="button"
            disabled={loading || selectedCount === 0}
            title="逐张下载所选记录的原图(不打包成 ZIP)"
            onClick={() => {
              void runDownloadOriginals();
            }}
          >
            <Images size={13} aria-hidden />
            逐张原图
          </button>
          <input
            className="input"
            value={tags}
            disabled={loading}
            placeholder="批量添加标签，逗号分隔"
            onChange={(event) => setTags(event.target.value)}
          />
          {/* 改用 .status action-button 风格,与 /records 卡片上的「复制 / 重做 / 删除」、筛选/重置一脉相承 */}
          <button
            className="status action-button action-add"
            type="button"
            disabled={loading || selectedCount === 0 || !tags.trim()}
            onClick={() => {
              void runBulk("add_tags");
            }}
          >
            <Tags size={13} aria-hidden />
            加标签
          </button>
          <button
            className="status action-button action-danger"
            type="button"
            disabled={loading || selectedCount === 0}
            onClick={() => setConfirmDeleteOpen(true)}
          >
            <Trash2 size={13} aria-hidden />
            批量删除
          </button>
        </div>
      </form>
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

/**
 * 薄壳:server page 不能用 hook,所以把 useRecordsSelection 读 selectedCount 的逻辑
 * 放在这里,把数字注入到通用的 <RecordsToolTabs />(/favorites 同理用 FavoritesToolTabsBridge)
 */
export function RecordsToolTabsBridge() {
  const { selectedCount } = useRecordsSelection();
  const { open } = useRecordsToolPanel();
  const prevCount = useRef(0);
  useEffect(() => {
    // 0 → >0:刚开始勾选时自动展开批量栏(下载/加标签/删除);已展开或手动关过则不再打扰。
    if (selectedCount > 0 && prevCount.current === 0) open("tags");
    prevCount.current = selectedCount;
  }, [selectedCount, open]);
  return <RecordsToolTabs selectedCount={selectedCount} />;
}
