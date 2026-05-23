"use client";

import { useEffect, useMemo, useState } from "react";
import type { MouseEvent } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, Check, ImagePlus, Send, Trash2, X } from "lucide-react";
import { imageThumbnailUrl } from "@/lib/thumbnails";

export type ReferenceBasketItem = {
  imageId: string;
  prompt?: string;
  addedAt: string;
};

export const MAX_REFERENCE_BASKET_ITEMS = 4;
export const REFERENCE_BASKET_APPLY_EVENT = "ai-image-reference-basket-apply";

const REFERENCE_BASKET_STORAGE_KEY = "ai-image-reference-basket-v1";
const REFERENCE_BASKET_CHANGE_EVENT = "ai-image-reference-basket-change";

function normalizeBasketItems(value: unknown): ReferenceBasketItem[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const items: ReferenceBasketItem[] = [];

  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const imageId = typeof record.imageId === "string" ? record.imageId.trim() : "";
    if (!imageId || seen.has(imageId)) continue;
    seen.add(imageId);
    items.push({
      imageId,
      prompt: typeof record.prompt === "string" ? record.prompt : undefined,
      addedAt: typeof record.addedAt === "string" ? record.addedAt : new Date().toISOString()
    });
    if (items.length >= MAX_REFERENCE_BASKET_ITEMS) break;
  }

  return items;
}

export function readReferenceBasketItems(): ReferenceBasketItem[] {
  if (typeof window === "undefined") return [];
  try {
    return normalizeBasketItems(JSON.parse(window.localStorage.getItem(REFERENCE_BASKET_STORAGE_KEY) ?? "[]"));
  } catch {
    return [];
  }
}

function writeReferenceBasketItems(items: ReferenceBasketItem[]) {
  const normalized = normalizeBasketItems(items);
  window.localStorage.setItem(REFERENCE_BASKET_STORAGE_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent(REFERENCE_BASKET_CHANGE_EVENT, { detail: normalized }));
  return normalized;
}

function subscribeReferenceBasket(listener: (items: ReferenceBasketItem[]) => void) {
  const handleChange = () => listener(readReferenceBasketItems());
  const handleCustomChange = (event: Event) => {
    const items = (event as CustomEvent<ReferenceBasketItem[]>).detail;
    listener(Array.isArray(items) ? normalizeBasketItems(items) : readReferenceBasketItems());
  };

  window.addEventListener("storage", handleChange);
  window.addEventListener(REFERENCE_BASKET_CHANGE_EVENT, handleCustomChange);
  return () => {
    window.removeEventListener("storage", handleChange);
    window.removeEventListener(REFERENCE_BASKET_CHANGE_EVENT, handleCustomChange);
  };
}

function useReferenceBasket() {
  const [items, setItems] = useState<ReferenceBasketItem[]>([]);

  useEffect(() => {
    setItems(readReferenceBasketItems());
    return subscribeReferenceBasket(setItems);
  }, []);

  return [items, setItems] as const;
}

function shortImageId(imageId: string) {
  return imageId.slice(0, 8);
}

function addOrRemoveBasketItem(current: ReferenceBasketItem[], item: ReferenceBasketItem) {
  if (current.some((entry) => entry.imageId === item.imageId)) {
    return current.filter((entry) => entry.imageId !== item.imageId);
  }
  if (current.length >= MAX_REFERENCE_BASKET_ITEMS) return current;
  return [...current, item].slice(0, MAX_REFERENCE_BASKET_ITEMS);
}

export function ReferenceBasketButton({
  imageId,
  prompt,
  label = "参考",
  addedLabel = "已选"
}: {
  imageId: string;
  prompt?: string;
  label?: string;
  addedLabel?: string;
}) {
  const [items, setItems] = useReferenceBasket();
  const selected = items.some((item) => item.imageId === imageId);
  const full = items.length >= MAX_REFERENCE_BASKET_ITEMS && !selected;

  function toggle() {
    const next = writeReferenceBasketItems(
      addOrRemoveBasketItem(items, {
        imageId,
        prompt,
        addedAt: new Date().toISOString()
      })
    );
    setItems(next);
  }

  return (
    <button
      className={`status action-button reference-basket-button${selected ? " selected" : ""}`}
      type="button"
      onClick={toggle}
      disabled={full}
      title={full ? `参考图篮最多 ${MAX_REFERENCE_BASKET_ITEMS} 张` : selected ? "从参考图篮移除" : "加入参考图篮"}
    >
      {selected ? <Check size={13} /> : <ImagePlus size={13} />}
      {full ? "已满" : selected ? addedLabel : label}
    </button>
  );
}

export function ReferenceBasketTray() {
  const [items, setItems] = useReferenceBasket();
  // 之前桌面端在 count>0 时会自动 setOpen(true)（通过 matchMedia 区分移动端
  // 才保持收缩),效果是托盘一加入就盖住右下角内容。改成全局默认收缩,只
  // 显示底部"参考图 N/M"按钮,用户主动点击才展开,避免遮挡。
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const count = items.length;
  const hasItems = count > 0;

  useEffect(() => {
    setMounted(true);
  }, []);

  const title = useMemo(() => `参考图 ${count}/${MAX_REFERENCE_BASKET_ITEMS}`, [count]);
  if (!mounted || !hasItems) return null;

  function update(next: ReferenceBasketItem[]) {
    const normalized = writeReferenceBasketItems(next);
    setItems(normalized);
    if (normalized.length === 0) setOpen(false);
  }

  function remove(imageId: string) {
    update(items.filter((item) => item.imageId !== imageId));
  }

  function move(imageId: string, direction: -1 | 1) {
    const index = items.findIndex((item) => item.imageId === imageId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= items.length) return;
    const next = [...items];
    const [item] = next.splice(index, 1);
    next.splice(nextIndex, 0, item);
    update(next);
  }

  function clear() {
    update([]);
  }

  function apply(event: MouseEvent<HTMLAnchorElement>) {
    if (window.location.pathname === "/") {
      event.preventDefault();
      window.dispatchEvent(new CustomEvent(REFERENCE_BASKET_APPLY_EVENT));
      setOpen(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  const tray = (
    <div className={`reference-basket-tray${open ? " open" : ""}`}>
      {open ? (
        <div className="reference-basket-panel">
          <div className="reference-basket-head">
            <strong>{title}</strong>
            <button className="icon-button" type="button" onClick={() => setOpen(false)} aria-label="收起参考图篮">
              <X size={15} />
            </button>
          </div>
          <div className="reference-basket-list">
            {items.map((item, index) => (
              <div className="reference-basket-item" key={item.imageId}>
                <img src={imageThumbnailUrl(item.imageId)} alt="" />
                <div>
                  <strong>{index === 0 ? "主参考图" : `参考图 ${index + 1}`}</strong>
                  <p className="small muted" title={item.prompt}>{item.prompt || shortImageId(item.imageId)}</p>
                </div>
                <div className="reference-basket-item-actions">
                  <button className="icon-button" type="button" disabled={index === 0} onClick={() => move(item.imageId, -1)} aria-label="上移">
                    <ArrowUp size={14} />
                  </button>
                  <button
                    className="icon-button"
                    type="button"
                    disabled={index === items.length - 1}
                    onClick={() => move(item.imageId, 1)}
                    aria-label="下移"
                  >
                    <ArrowDown size={14} />
                  </button>
                  <button className="icon-button danger" type="button" onClick={() => remove(item.imageId)} aria-label="移除">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="reference-basket-actions">
            <button className="status" type="button" onClick={clear}>
              清空
            </button>
            <a className="button" href="/?basket=1" onClick={apply}>
              <Send size={14} />
              去生成
            </a>
          </div>
        </div>
      ) : null}
      <button className="reference-basket-toggle" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <ImagePlus size={15} />
        <span>{title}</span>
      </button>
    </div>
  );

  return createPortal(tray, document.body);
}
