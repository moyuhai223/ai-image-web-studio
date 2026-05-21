"use client";

import { ChevronLeft, ChevronRight, Download, X, ZoomIn, ZoomOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { thumbnailSrc } from "@/lib/thumbnails";

const MIN_SCALE = 1;
const MAX_SCALE = 8;
const WHEEL_ZOOM_FACTOR = 1.18;
const BUTTON_ZOOM_FACTOR = 1.5;
const DOUBLE_CLICK_SCALE = 2.5;

export type LightboxItem = {
  src: string;
  downloadHref: string;
  alt: string;
  compare?: {
    src: string;
    alt: string;
    beforeLabel?: string;
    afterLabel?: string;
  };
};

type PointerPoint = {
  x: number;
  y: number;
};

type InteractionState = "idle" | "panning" | "pinching";
type LightboxMode = "single" | "compare";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function distanceBetween(a: PointerPoint, b: PointerPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpointBetween(a: PointerPoint, b: PointerPoint) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2
  };
}

export function ImageLightbox({
  src,
  downloadHref,
  alt,
  items,
  initialIndex = 0,
  autoOpen = false,
  autoOpenQueryParam,
  previousPageHref,
  nextPageHref,
  children
}: {
  src: string;
  downloadHref: string;
  alt: string;
  items?: LightboxItem[];
  initialIndex?: number;
  autoOpen?: boolean;
  autoOpenQueryParam?: string;
  previousPageHref?: string;
  nextPageHref?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const fallbackItem: LightboxItem = { src, downloadHref, alt };
  const galleryItems: LightboxItem[] = items?.length ? items : [fallbackItem];
  const safeInitialIndex = clamp(initialIndex, 0, galleryItems.length - 1);
  const [open, setOpen] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(safeInitialIndex);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState<PointerPoint>({ x: 0, y: 0 });
  const [interaction, setInteraction] = useState<InteractionState>("idle");
  const [mode, setMode] = useState<LightboxMode>("single");
  const imageWrapRef = useRef<HTMLDivElement>(null);
  const compareViewportRef = useRef<HTMLDivElement>(null);
  const filmstripRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const activePointers = useRef(new Map<number, PointerPoint>());
  const scaleRef = useRef(1);
  const offsetRef = useRef<PointerPoint>({ x: 0, y: 0 });
  const naturalSizeRef = useRef({ width: 0, height: 0 });
  const panStart = useRef<{ pointerId: number; x: number; y: number; offset: PointerPoint } | null>(null);
  const pinchStart = useRef<{ distance: number; focus: PointerPoint; scale: number } | null>(null);
  const currentItem = galleryItems[currentIndex] ?? galleryItems[safeInitialIndex] ?? fallbackItem;
  const canCompare = Boolean(currentItem.compare);
  const compareMode = canCompare && mode === "compare";
  const canGoPrevious = currentIndex > 0 || Boolean(previousPageHref);
  const canGoNext = currentIndex < galleryItems.length - 1 || Boolean(nextPageHref);
  const showNavigation = galleryItems.length > 1 || Boolean(previousPageHref || nextPageHref);

  function getPinchPoints() {
    const points = Array.from(activePointers.current.values());
    if (points.length < 2) return null;
    return [points[0], points[1]] as const;
  }

  function getFitMetrics(nextScale: number) {
    const wrap = compareMode ? compareViewportRef.current : imageWrapRef.current;
    const naturalSize = naturalSizeRef.current;
    if (!wrap || naturalSize.width <= 0 || naturalSize.height <= 0) {
      return { overflowX: 0, overflowY: 0 };
    }

    const fitRatio = Math.min(
      1,
      wrap.clientWidth / naturalSize.width,
      wrap.clientHeight / naturalSize.height
    );
    const width = naturalSize.width * fitRatio * nextScale;
    const height = naturalSize.height * fitRatio * nextScale;

    return {
      overflowX: Math.max(0, (width - wrap.clientWidth) / 2),
      overflowY: Math.max(0, (height - wrap.clientHeight) / 2)
    };
  }

  function clampOffset(nextScale: number, nextOffset: PointerPoint) {
    if (nextScale <= MIN_SCALE) return { x: 0, y: 0 };

    const { overflowX, overflowY } = getFitMetrics(nextScale);
    return {
      x: clamp(nextOffset.x, -overflowX, overflowX),
      y: clamp(nextOffset.y, -overflowY, overflowY)
    };
  }

  function setView(nextScale: number, nextOffset = offsetRef.current) {
    const clampedScale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
    const clampedOffset = clampOffset(clampedScale, nextOffset);

    scaleRef.current = clampedScale;
    offsetRef.current = clampedOffset;
    setScale(clampedScale);
    setOffset(clampedOffset);
  }

  function resetView() {
    activePointers.current.clear();
    panStart.current = null;
    pinchStart.current = null;
    setInteraction("idle");
    setView(1, { x: 0, y: 0 });
  }

  function clearAutoOpenQuery() {
    if (!autoOpenQueryParam) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has(autoOpenQueryParam)) return;
    url.searchParams.delete(autoOpenQueryParam);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function close() {
    setOpen(false);
    resetView();
  }

  function openLightbox() {
    const nextIndex = clamp(initialIndex, 0, galleryItems.length - 1);
    const nextItem = galleryItems[nextIndex] ?? fallbackItem;
    naturalSizeRef.current = { width: 0, height: 0 };
    setCurrentIndex(nextIndex);
    setMode(nextItem.compare ? "compare" : "single");
    resetView();
    setOpen(true);
  }

  function goToImage(nextIndex: number) {
    if (nextIndex < 0 || nextIndex >= galleryItems.length || nextIndex === currentIndex) return;
    const nextItem = galleryItems[nextIndex] ?? fallbackItem;
    naturalSizeRef.current = { width: 0, height: 0 };
    setCurrentIndex(nextIndex);
    setMode(nextItem.compare ? "compare" : "single");
    resetView();
  }

  function navigateToPage(href: string) {
    setOpen(false);
    resetView();
    router.push(href);
  }

  function goPrevious() {
    if (currentIndex > 0) {
      goToImage(currentIndex - 1);
      return;
    }
    if (previousPageHref) navigateToPage(previousPageHref);
  }

  function goNext() {
    if (currentIndex < galleryItems.length - 1) {
      goToImage(currentIndex + 1);
      return;
    }
    if (nextPageHref) navigateToPage(nextPageHref);
  }

  function setZoom(nextScale: number, focus?: PointerPoint) {
    const currentScale = scaleRef.current;
    const currentOffset = offsetRef.current;
    const clampedScale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
    let nextOffset = currentOffset;

    if (focus && clampedScale !== currentScale) {
      const wrap = compareMode ? compareViewportRef.current : imageWrapRef.current;
      const rect = wrap?.getBoundingClientRect();
      if (rect) {
        const centerX = focus.x - (rect.left + rect.width / 2);
        const centerY = focus.y - (rect.top + rect.height / 2);
        const ratio = clampedScale / currentScale;
        nextOffset = {
          x: (currentOffset.x - centerX) * ratio + centerX,
          y: (currentOffset.y - centerY) * ratio + centerY
        };
      }
    }

    panStart.current = null;
    setView(clampedScale, nextOffset);
  }

  function handlePointerEnd(event: React.PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    activePointers.current.delete(event.pointerId);

    if (activePointers.current.size < 2) {
      pinchStart.current = null;
    }
    if (panStart.current?.pointerId === event.pointerId) {
      panStart.current = null;
    }
    if (activePointers.current.size === 0) {
      setInteraction("idle");
    }
  }

  useEffect(() => {
    if (!open) return;

    function reconcileView() {
      setView(scaleRef.current, offsetRef.current);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        close();
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goPrevious();
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        goNext();
        return;
      }
      if (event.key === "0" || event.key === "1") {
        event.preventDefault();
        resetView();
        return;
      }
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        setZoom(scaleRef.current * BUTTON_ZOOM_FACTOR);
        return;
      }
      if (event.key === "-") {
        event.preventDefault();
        setZoom(scaleRef.current / BUTTON_ZOOM_FACTOR);
      }
    }

    function onWheel(event: WheelEvent) {
      event.preventDefault();
      const factor = event.deltaY < 0 ? WHEEL_ZOOM_FACTOR : 1 / WHEEL_ZOOM_FACTOR;
      setZoom(scaleRef.current * factor, { x: event.clientX, y: event.clientY });
    }

    document.body.style.overflow = "hidden";
    reconcileView();
    const resizeObserver = new ResizeObserver(reconcileView);
    if (imageWrapRef.current) resizeObserver.observe(imageWrapRef.current);
    if (compareViewportRef.current) resizeObserver.observe(compareViewportRef.current);
    imageWrapRef.current?.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = "";
      resizeObserver.disconnect();
      imageWrapRef.current?.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [compareMode, currentIndex, galleryItems.length, nextPageHref, open, previousPageHref]);

  useEffect(() => {
    if (!autoOpen) return;
    clearAutoOpenQuery();
    openLightbox();
  }, [autoOpen]);

  useEffect(() => {
    if (!open || galleryItems.length <= 1) return;

    const activeThumb = filmstripRef.current?.querySelector<HTMLElement>("[data-active='true']");
    activeThumb?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [currentIndex, galleryItems.length, open]);

  return (
    <>
      <button
        className="image-open-button"
        type="button"
        onClick={openLightbox}
      >
        {children}
      </button>
      {open ? createPortal(
        <div className="lightbox" role="dialog" aria-modal="true" aria-label="图片预览" onClick={close}>
          <div className="lightbox-backdrop" aria-hidden="true" />
          <div className="lightbox-stage">
            <div className="lightbox-toolbar" onClick={(event) => event.stopPropagation()}>
              <button
                className="lightbox-action"
                type="button"
                disabled={scale <= MIN_SCALE}
                onClick={() => setZoom(scaleRef.current / BUTTON_ZOOM_FACTOR)}
              >
                <ZoomOut size={18} />
                缩小
              </button>
              <span className="lightbox-meter">{Math.round(scale * 100)}%</span>
              {showNavigation ? (
                <span className="lightbox-meter">{currentIndex + 1} / {galleryItems.length}</span>
              ) : null}
              <button
                className="lightbox-action"
                type="button"
                disabled={scale >= MAX_SCALE}
                onClick={() => setZoom(scaleRef.current * BUTTON_ZOOM_FACTOR)}
              >
                <ZoomIn size={18} />
                放大
              </button>
              {canCompare ? (
                <button
                  className="lightbox-action"
                  type="button"
                  onClick={() => {
                    resetView();
                    setMode((value) => (value === "compare" ? "single" : "compare"));
                  }}
                >
                  {compareMode ? "单图" : "对比"}
                </button>
              ) : null}
              <a className="lightbox-action" href={currentItem.downloadHref}>
                <Download size={18} />
                下载
              </a>
              <button className="lightbox-action" type="button" onClick={close}>
                <X size={18} />
                关闭
              </button>
            </div>
            <div
              ref={imageWrapRef}
              className="lightbox-image-wrap"
              onClick={(event) => event.stopPropagation()}
              onDoubleClick={(event) => {
                event.stopPropagation();
                if (scaleRef.current > 1.1) {
                  resetView();
                  return;
                }
                setZoom(DOUBLE_CLICK_SCALE, { x: event.clientX, y: event.clientY });
              }}
              onPointerDown={(event) => {
                event.stopPropagation();
                activePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
                event.currentTarget.setPointerCapture(event.pointerId);

                const pinchPoints = getPinchPoints();
                if (event.pointerType === "touch" && pinchPoints) {
                  pinchStart.current = {
                    distance: Math.max(1, distanceBetween(pinchPoints[0], pinchPoints[1])),
                    focus: midpointBetween(pinchPoints[0], pinchPoints[1]),
                    scale: scaleRef.current
                  };
                  panStart.current = null;
                  setInteraction("pinching");
                  return;
                }

                if (activePointers.current.size === 1 && scaleRef.current > 1) {
                  panStart.current = {
                    pointerId: event.pointerId,
                    x: event.clientX,
                    y: event.clientY,
                    offset: offsetRef.current
                  };
                  setInteraction("panning");
                }
              }}
              onPointerMove={(event) => {
                if (!activePointers.current.has(event.pointerId)) return;

                activePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

                const pinchPoints = getPinchPoints();
                if (pinchStart.current && pinchPoints) {
                  event.preventDefault();
                  event.stopPropagation();
                  const nextDistance = Math.max(1, distanceBetween(pinchPoints[0], pinchPoints[1]));
                  setZoom(
                    pinchStart.current.scale * (nextDistance / pinchStart.current.distance),
                    pinchStart.current.focus
                  );
                  return;
                }

                if (!panStart.current || panStart.current.pointerId !== event.pointerId || scaleRef.current <= 1) {
                  return;
                }

                event.preventDefault();
                event.stopPropagation();
                setView(scaleRef.current, {
                  x: panStart.current.offset.x + event.clientX - panStart.current.x,
                  y: panStart.current.offset.y + event.clientY - panStart.current.y
                });
              }}
              onPointerUp={handlePointerEnd}
              onPointerCancel={handlePointerEnd}
              onPointerLeave={(event) => {
                if (event.pointerType === "mouse") handlePointerEnd(event);
              }}
              style={{
                cursor: scale > 1 ? (interaction === "panning" ? "grabbing" : "grab") : "zoom-in"
              }}
            >
              {compareMode && currentItem.compare ? (
                <div className="lightbox-compare-grid">
                  <figure className="lightbox-compare-pane">
                    <figcaption>{currentItem.compare.beforeLabel ?? "主修改图"}</figcaption>
                    <div ref={compareViewportRef} className="lightbox-compare-viewport">
                      <img
                        className={`lightbox-compare-image ${interaction !== "idle" ? "is-interacting" : ""}`}
                        src={currentItem.compare.src}
                        alt={currentItem.compare.alt}
                        draggable={false}
                        style={{
                          transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`
                        }}
                      />
                    </div>
                  </figure>
                  <figure className="lightbox-compare-pane">
                    <figcaption>{currentItem.compare.afterLabel ?? "成品图"}</figcaption>
                    <div className="lightbox-compare-viewport">
                      <img
                        className={`lightbox-compare-image ${interaction !== "idle" ? "is-interacting" : ""}`}
                        src={currentItem.src}
                        alt={currentItem.alt}
                        draggable={false}
                        onLoad={(event) => {
                          naturalSizeRef.current = {
                            width: event.currentTarget.naturalWidth,
                            height: event.currentTarget.naturalHeight
                          };
                          setView(scaleRef.current, offsetRef.current);
                        }}
                        style={{
                          transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`
                        }}
                      />
                    </div>
                  </figure>
                </div>
              ) : (
                <div className="lightbox-image-canvas">
                  <img
                    key={currentItem.src}
                    ref={imageRef}
                    className={`lightbox-image ${interaction !== "idle" ? "is-interacting" : ""}`}
                    src={currentItem.src}
                    alt={currentItem.alt}
                    draggable={false}
                    onLoad={(event) => {
                      naturalSizeRef.current = {
                        width: event.currentTarget.naturalWidth,
                        height: event.currentTarget.naturalHeight
                      };
                      setView(scaleRef.current, offsetRef.current);
                    }}
                    style={{
                      transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`
                    }}
                  />
                </div>
              )}
              {showNavigation ? (
                <>
                  <button
                    className="lightbox-nav-button previous"
                    type="button"
                    aria-label={currentIndex > 0 ? "上一张" : "上一页"}
                    disabled={!canGoPrevious}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      goPrevious();
                    }}
                  >
                    <ChevronLeft size={28} />
                  </button>
                  <button
                    className="lightbox-nav-button next"
                    type="button"
                    aria-label={currentIndex < galleryItems.length - 1 ? "下一张" : "下一页"}
                    disabled={!canGoNext}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      goNext();
                    }}
                  >
                    <ChevronRight size={28} />
                  </button>
                </>
              ) : null}
            </div>
            {galleryItems.length > 1 ? (
              <div
                ref={filmstripRef}
                className="lightbox-filmstrip"
                aria-label="图片缩略图导航"
                onClick={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
              >
                {galleryItems.map((item, index) => {
                  const active = index === currentIndex;
                  return (
                    <button
                      key={`${item.src}-${index}`}
                      className={`lightbox-filmstrip-button${active ? " active" : ""}`}
                      type="button"
                      aria-label={`查看第 ${index + 1} 张图片`}
                      aria-current={active ? "true" : undefined}
                      data-active={active ? "true" : undefined}
                      onClick={() => goToImage(index)}
                    >
                      <img src={thumbnailSrc(item.src)} alt="" loading="lazy" draggable={false} />
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>,
        document.body
      ) : null}
    </>
  );
}
