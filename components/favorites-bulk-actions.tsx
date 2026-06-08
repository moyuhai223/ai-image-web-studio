"use client";

/**
 * /favorites 的批量管理:与 records-bulk-actions 镜像,但
 *   - 选择单位是 image(收藏行的主键是 image_id)
 *   - 危险动作不是"删图",而是"批量取消收藏"(只解除当前用户的收藏关联,不动图、不动他人)
 *   - 加标签调用同一套 `addTagsToImagesForUser` 仓库函数,只是接口走 /api/favorites/bulk
 *
 * 同步暴露 `FavoritesToolTabsBridge`,把 `useFavoritesSelection().selectedCount`
 * 注入到通用的 `<RecordsToolTabs />`(/records 用 RecordsToolTabsBridge 同理).
 */

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Download, HeartOff, Images, Tags } from "lucide-react";
import { DangerConfirmDialog } from "./danger-confirm-dialog";
import { downloadImagesZip, downloadOriginalImages } from "./download-zip";
import { RecordsToolTabs, useRecordsToolPanel } from "./records-tool-panels";

export const FAVORITES_BULK_FORM_ID = "favorites-bulk-form";

type BulkResponse = {
  error?: string;
  removed?: number;
  imageCount?: number;
  tags?: string[];
};

type FavoritesSelectionContextValue = {
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

const FavoritesSelectionContext = createContext<FavoritesSelectionContextValue | null>(null);

export function useFavoritesSelection() {
  const context = useContext(FavoritesSelectionContext);
  if (!context) {
    throw new Error("Favorites selection context is missing");
  }
  return context;
}

export function FavoritesSelectionProvider({ ids, children }: { ids: string[]; children: ReactNode }) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setSelectedIds((current) => {
      const visible = new Set(ids);
      const next = new Set(Array.from(current).filter((id) => visible.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [ids]);

  const value = useMemo<FavoritesSelectionContextValue>(() => {
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

  return <FavoritesSelectionContext.Provider value={value}>{children}</FavoritesSelectionContext.Provider>;
}

export function FavoriteSelectCheckbox({ imageId }: { imageId: string }) {
  const { loading, selectedIds, toggleId } = useFavoritesSelection();
  const selected = selectedIds.has(imageId);

  return (
    <label className={`record-select-control${selected ? " selected" : ""}`} aria-label={selected ? "取消选择图片" : "选择图片"}>
      <input
        data-record-select
        type="checkbox"
        checked={selected}
        disabled={loading}
        onChange={(event) => toggleId(imageId, event.target.checked)}
      />
    </label>
  );
}

export function FavoritesBulkActions() {
  const router = useRouter();
  const { ids, selectedIds, selectedCount, allSelected, loading, setLoading, toggleId, togglePage, clearSelection } = useFavoritesSelection();
  const [tags, setTags] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmUnfavoriteOpen, setConfirmUnfavoriteOpen] = useState(false);

  function selectedIdList() {
    return Array.from(selectedIds);
  }

  function clearSingle(id: string) {
    toggleId(id, false);
  }

  useEffect(() => {
    setError("");
  }, [selectedCount]);

  async function runBulk(action: "unfavorite" | "add_tags") {
    const ids = selectedIdList();
    setError("");
    setMessage("");
    if (ids.length === 0) {
      setError("请先选择图片");
      return;
    }

    setLoading(true);
    const response = await fetch("/api/favorites/bulk", {
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

    if (action === "unfavorite") {
      setConfirmUnfavoriteOpen(false);
      setMessage(`已取消 ${data.removed ?? 0} 张图片的收藏。`);
      clearSelection();
      router.refresh();
      return;
    }

    setMessage(`已为 ${data.imageCount ?? 0} 张图片添加标签。`);
    setTags("");
    router.refresh();
  }

  async function runDownload() {
    const ids = selectedIdList();
    setError("");
    setMessage("");
    if (ids.length === 0) {
      setError("请先选择图片");
      return;
    }
    setLoading(true);
    const result = await downloadImagesZip({ imageIds: ids });
    setLoading(false);
    if (!result.ok) {
      setError(result.error ?? "下载失败");
      return;
    }
    setMessage(`已开始下载所选 ${ids.length} 张图片 ZIP。`);
  }

  async function runDownloadOriginals() {
    const ids = selectedIdList();
    setError("");
    setMessage("");
    if (ids.length === 0) {
      setError("请先选择图片");
      return;
    }
    setLoading(true);
    const result = await downloadOriginalImages({ imageIds: ids });
    setLoading(false);
    if (!result.ok) {
      setError(result.error ?? "下载失败");
      return;
    }
    setMessage(`已开始逐张下载 ${result.count ?? 0} 张原图(浏览器若提示允许多文件下载,请允许)。`);
  }

  function closeUnfavoriteConfirm() {
    if (loading) return;
    setConfirmUnfavoriteOpen(false);
    setError("");
  }

  return (
    <>
      <form id={FAVORITES_BULK_FORM_ID} className="records-bulk-bar" onSubmit={(event) => event.preventDefault()}>
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
          <div className="records-selected-list" aria-label="已选择图片">
            {Array.from(selectedIds).map((id) => (
              <button className="record-selected-chip" type="button" key={id} disabled={loading} onClick={() => clearSingle(id)}>
                {id.slice(0, 8)}
                <span aria-hidden="true">×</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="small muted records-selected-empty">勾选图片卡片左上角选择框,或点击本页全选后再取消不需要的图片。</p>
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
            title="逐张下载所选原图(不打包成 ZIP)"
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
            placeholder="批量为已选图片添加标签,逗号分隔"
            onChange={(event) => setTags(event.target.value)}
          />
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
            onClick={() => setConfirmUnfavoriteOpen(true)}
          >
            <HeartOff size={13} aria-hidden />
            批量取消收藏
          </button>
        </div>
      </form>
      <DangerConfirmDialog
        open={confirmUnfavoriteOpen}
        title="确认批量取消收藏"
        description={`会从你的收藏作品集移除所选 ${selectedCount} 张图片。图片本身不会被删除,其他用户的收藏也不受影响。`}
        confirmLabel="批量取消收藏"
        loadingLabel="处理中"
        loading={loading}
        error={error}
        onClose={closeUnfavoriteConfirm}
        onConfirm={() => {
          void runBulk("unfavorite");
        }}
      />
    </>
  );
}

/**
 * 薄壳:server page 不能用 hook,所以把 useFavoritesSelection 读 selectedCount 的逻辑
 * 放在这里,把数字注入到通用的 <RecordsToolTabs />(/records 同理用 RecordsToolTabsBridge)
 */
export function FavoritesToolTabsBridge() {
  const { selectedCount } = useFavoritesSelection();
  const { open } = useRecordsToolPanel();
  const prevCount = useRef(0);
  useEffect(() => {
    if (selectedCount > 0 && prevCount.current === 0) open("tags");
    prevCount.current = selectedCount;
  }, [selectedCount, open]);
  return <RecordsToolTabs selectedCount={selectedCount} />;
}
