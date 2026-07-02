"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Brush, Check, Eraser, Expand, Hand, Lasso, PenTool, Trash2, X, ZoomIn, ZoomOut } from "lucide-react";

const MAX_SIDE = 1600; // 画布内部分辨率上限(长边)

type Point = { x: number; y: number };
type Tool = "brush" | "lasso" | "polygon" | "eraser" | "pan";

type Props = {
  imageSrc: string;
  onChange: (mask: Blob | null) => void;
  onClose: () => void;
};

const PAINT_COLOR = "rgba(239,68,68,0.55)";
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

const MIN_SCALE = 0.3;
const MAX_SCALE = 8;
type View = { scale: number; tx: number; ty: number };

/**
 * 局部重绘蒙版编辑器(近全屏弹窗):
 * - 画笔:拖动涂抹;橡皮:擦除;套索:拖一圈自动填充;多边形:点击落点、点回起点/双击闭合填充。
 * - 视图:滚轮以光标为中心缩放,「移动」工具/按住空格/鼠标中键拖拽平移,双指捏合缩放,百分比按钮复位。
 *   transform 只作用于 stage 视觉层;pointerPos 用 rect 比例换算,绘制坐标天然穿透缩放。
 * - 笔刷默认大小随图自适应。双 canvas:底层 paint(已提交蒙版,红) + 顶层 preview(套索/多边形实时轮廓)。
 * - 导出黑白 PNG(涂过=白=要改、未涂=黑=保留)。
 */
export function MaskEditor({ imageSrc, onChange, onClose }: Props) {
  const paintRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const drawingRef = useRef(false);
  const lastRef = useRef<Point | null>(null);
  const lassoRef = useRef<Point[]>([]);
  const polyRef = useRef<Point[]>([]);
  const polyActiveRef = useRef(false);
  const panningRef = useRef<{ pointerId: number; startX: number; startY: number; tx: number; ty: number } | null>(null);
  const spaceRef = useRef(false);
  const pinchRef = useRef<Map<number, Point>>(new Map());
  // 触屏防误涂:第一指落下先拍 paint 层快照;若随后第二指落下(捏合意图),整笔撤销。
  const strokeSnapshotRef = useRef<ImageData | null>(null);
  // 多边形同理:记录「最近一个点是触屏刚加的」,捏合开始时弹掉它。
  const touchPolyPointRef = useRef(false);
  const [tool, setTool] = useState<Tool>("brush");
  const [brush, setBrush] = useState(80);
  const [hasStrokes, setHasStrokes] = useState(false);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  const [view, setView] = useState<View>({ scale: 1, tx: 0, ty: 0 });
  const [spaceHeld, setSpaceHeld] = useState(false);
  const viewRef = useRef(view);
  viewRef.current = view;

  const maxDim = dims ? Math.max(dims.w, dims.h) : 1000;
  const brushMin = Math.max(6, Math.round(maxDim * 0.008));
  const brushMax = Math.max(120, Math.round(maxDim * 0.4));
  const closeThreshold = maxDim * 0.025;
  const previewLine = Math.max(2, Math.round(maxDim / 400));

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // 多边形进行中:Esc 先取消当前多边形,否则关闭弹窗
        if (polyActiveRef.current) {
          cancelPolygon();
        } else {
          onClose();
        }
        return;
      }
      // 按住空格临时切换为平移(Photoshop 习惯)。焦点在输入框时不拦,避免吃掉正常输入。
      if (e.code === "Space") {
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
        e.preventDefault();
        if (!spaceRef.current) {
          spaceRef.current = true;
          setSpaceHeld(true);
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spaceRef.current = false;
        setSpaceHeld(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      document.body.style.overflow = prev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose]);

  // 以某客户端坐标为锚点缩放(可叠加平移增量 dx/dy,供捏合用)。
  // stage 由 flex 居中,未变换中心恒等于 body 中心(与 transform 状态无关),
  // 由此推导:锚点处图像点不动 ⇒ tx' = anchor - c0 - r·(anchor - c0 - tx)。
  function applyView(anchorX: number, anchorY: number, ratio: number, dx = 0, dy = 0) {
    const body = bodyRef.current;
    if (!body) return;
    const rect = body.getBoundingClientRect();
    const c0x = rect.left + rect.width / 2;
    const c0y = rect.top + rect.height / 2;
    setView((v) => {
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * ratio));
      const r = next / v.scale;
      const tx = v.tx + dx;
      const ty = v.ty + dy;
      return {
        scale: next,
        tx: anchorX - c0x - (anchorX - c0x - tx) * r,
        ty: anchorY - c0y - (anchorY - c0y - ty) * r
      };
    });
  }

  // 按钮缩放:以视口中心为锚
  function zoomAtCenter(ratio: number) {
    const body = bodyRef.current;
    if (!body) return;
    const rect = body.getBoundingClientRect();
    applyView(rect.left + rect.width / 2, rect.top + rect.height / 2, ratio);
  }

  // 滚轮缩放(以光标为中心)。React 的 onWheel 是 passive,preventDefault 无效,须原生监听。
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      applyView(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 1 / 1.12);
    };
    body.addEventListener("wheel", onWheel, { passive: false });
    return () => body.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  useEffect(() => {
    let cancelled = false;
    const img = new window.Image();
    img.onload = () => {
      if (cancelled) return;
      const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
      setDims({
        w: Math.max(1, Math.round((img.naturalWidth || 1) * scale)),
        h: Math.max(1, Math.round((img.naturalHeight || 1) * scale))
      });
    };
    img.src = imageSrc;
    return () => {
      cancelled = true;
    };
  }, [imageSrc]);

  useEffect(() => {
    if (!dims) return;
    for (const ref of [paintRef, previewRef]) {
      const c = ref.current;
      if (!c) continue;
      c.width = dims.w;
      c.height = dims.h;
      c.getContext("2d")?.clearRect(0, 0, dims.w, dims.h);
    }
    // 笔刷默认 ~5% 长边,随图自适应
    const md = Math.max(dims.w, dims.h);
    setBrush(Math.min(Math.max(120, Math.round(md * 0.4)), Math.max(Math.max(6, Math.round(md * 0.008)), Math.round(md * 0.05))));
    polyRef.current = [];
    polyActiveRef.current = false;
    lassoRef.current = [];
    setHasStrokes(false);
    setView({ scale: 1, tx: 0, ty: 0 });
    onChange(null);
  }, [dims, onChange]);

  function pointerPos(event: React.PointerEvent<HTMLCanvasElement>): Point {
    const c = previewRef.current!;
    const rect = c.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * c.width,
      y: ((event.clientY - rect.top) / rect.height) * c.height
    };
  }

  function paintBrush(from: Point, to: Point, erase: boolean) {
    const ctx = paintRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.globalCompositeOperation = erase ? "destination-out" : "source-over";
    ctx.strokeStyle = PAINT_COLOR;
    ctx.fillStyle = PAINT_COLOR;
    ctx.lineWidth = brush;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(to.x, to.y, brush / 2, 0, Math.PI * 2);
    ctx.fill();
  }

  function clearPreview() {
    const ctx = previewRef.current?.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }

  function drawOutline(pts: Point[], cursor: Point | null, closed: boolean) {
    const ctx = previewRef.current?.getContext("2d");
    if (!ctx || pts.length === 0) return;
    clearPreview();
    ctx.lineWidth = previewLine;
    ctx.strokeStyle = "rgba(239,68,68,0.95)";
    ctx.setLineDash([previewLine * 3, previewLine * 3]);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
    if (cursor) ctx.lineTo(cursor.x, cursor.y);
    if (closed) ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
    // 多边形:在起点画一个可点击闭合的圆点
    if (!closed && pts.length >= 3) {
      ctx.fillStyle = "rgba(239,68,68,0.95)";
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, previewLine * 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function fillPolygon(pts: Point[]) {
    const ctx = paintRef.current?.getContext("2d");
    if (!ctx || pts.length < 3) return;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = PAINT_COLOR;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.closePath();
    ctx.fill();
  }

  const exportMask = useCallback(() => {
    const canvas = paintRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const src = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const out = document.createElement("canvas");
    out.width = canvas.width;
    out.height = canvas.height;
    const octx = out.getContext("2d");
    if (!octx) return;
    const md = octx.createImageData(canvas.width, canvas.height);
    let painted = 0;
    for (let i = 0; i < src.data.length; i += 4) {
      const v = src.data[i + 3] > 10 ? 255 : 0;
      md.data[i] = v;
      md.data[i + 1] = v;
      md.data[i + 2] = v;
      md.data[i + 3] = 255;
      if (v === 255) painted += 1;
    }
    octx.putImageData(md, 0, 0);
    if (painted === 0) {
      setHasStrokes(false);
      onChange(null);
      return;
    }
    setHasStrokes(true);
    out.toBlob((blob) => onChange(blob), "image/png");
  }, [onChange]);

  function commitPolygon() {
    fillPolygon(polyRef.current);
    polyRef.current = [];
    polyActiveRef.current = false;
    clearPreview();
    exportMask();
  }

  function cancelPolygon() {
    polyRef.current = [];
    polyActiveRef.current = false;
    clearPreview();
  }

  function isPanGesture(event: React.PointerEvent<HTMLCanvasElement>) {
    return tool === "pan" || spaceRef.current || event.button === 1;
  }

  function onPointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    event.preventDefault();

    // 双指触摸:第二根手指落下 → 进入捏合缩放,取消进行中的笔画
    if (event.pointerType === "touch") {
      pinchRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pinchRef.current.size === 2) {
        // 防误涂:恢复第一指落下前的快照,撤销已画的半笔;多边形则弹掉第一指刚加的点
        const ctx = paintRef.current?.getContext("2d");
        if (ctx && strokeSnapshotRef.current) ctx.putImageData(strokeSnapshotRef.current, 0, 0);
        strokeSnapshotRef.current = null;
        if (touchPolyPointRef.current) {
          polyRef.current.pop();
          touchPolyPointRef.current = false;
          if (polyRef.current.length === 0) polyActiveRef.current = false;
        }
        drawingRef.current = false;
        lastRef.current = null;
        lassoRef.current = [];
        panningRef.current = null;
        clearPreview();
        return;
      }
    }

    if (isPanGesture(event)) {
      previewRef.current?.setPointerCapture(event.pointerId);
      panningRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        tx: viewRef.current.tx,
        ty: viewRef.current.ty
      };
      return;
    }

    const p = pointerPos(event);

    if (tool === "polygon") {
      const pts = polyRef.current;
      if (pts.length >= 3 && dist(p, pts[0]) <= closeThreshold) {
        touchPolyPointRef.current = false;
        commitPolygon();
      } else {
        pts.push(p);
        polyActiveRef.current = true;
        // 触屏落点先标记:若这根手指其实是捏合的第一指,第二指落下时弹掉该点
        touchPolyPointRef.current = event.pointerType === "touch";
        drawOutline(pts, p, false);
      }
      return;
    }

    // 触屏落笔先拍快照:若第二指随后落下(捏合意图),putImageData 整笔撤销
    if (event.pointerType === "touch") {
      const c = paintRef.current;
      const ctx = c?.getContext("2d");
      strokeSnapshotRef.current = c && ctx ? ctx.getImageData(0, 0, c.width, c.height) : null;
    }

    previewRef.current?.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    lastRef.current = p;
    if (tool === "lasso") {
      lassoRef.current = [p];
      drawOutline(lassoRef.current, null, true);
    } else {
      paintBrush(p, p, tool === "eraser");
    }
  }

  function onPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    // 双指捏合:以两指中点为锚缩放 + 跟随中点平移
    if (event.pointerType === "touch" && pinchRef.current.size === 2 && pinchRef.current.has(event.pointerId)) {
      const prev = new Map(pinchRef.current);
      pinchRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const [a1, b1] = [...prev.values()];
      const [a2, b2] = [...pinchRef.current.values()];
      const d1 = dist(a1, b1);
      const d2 = dist(a2, b2);
      if (d1 > 0 && d2 > 0) {
        const mid1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 };
        const mid2 = { x: (a2.x + b2.x) / 2, y: (a2.y + b2.y) / 2 };
        applyView(mid2.x, mid2.y, d2 / d1, mid2.x - mid1.x, mid2.y - mid1.y);
      }
      return;
    }

    if (panningRef.current?.pointerId === event.pointerId) {
      event.preventDefault();
      const pan = panningRef.current;
      setView((v) => ({ ...v, tx: pan.tx + event.clientX - pan.startX, ty: pan.ty + event.clientY - pan.startY }));
      return;
    }

    const p = pointerPos(event);
    if (tool === "polygon") {
      if (polyActiveRef.current) drawOutline(polyRef.current, p, false);
      return;
    }
    if (!drawingRef.current) return;
    event.preventDefault();
    if (tool === "lasso") {
      lassoRef.current.push(p);
      drawOutline(lassoRef.current, null, true);
    } else {
      paintBrush(lastRef.current ?? p, p, tool === "eraser");
    }
    lastRef.current = p;
  }

  function onPointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    pinchRef.current.delete(event.pointerId);
    // 正常抬指 = 这笔/这点确定保留,清掉防误涂的撤销依据
    strokeSnapshotRef.current = null;
    touchPolyPointRef.current = false;
    if (panningRef.current?.pointerId === event.pointerId) {
      panningRef.current = null;
      previewRef.current?.releasePointerCapture(event.pointerId);
      return;
    }
    if (tool === "polygon") return;
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastRef.current = null;
    previewRef.current?.releasePointerCapture(event.pointerId);
    if (tool === "lasso") {
      fillPolygon(lassoRef.current);
      lassoRef.current = [];
      clearPreview();
    }
    exportMask();
  }

  function onDoubleClick() {
    if (tool === "polygon" && polyActiveRef.current) commitPolygon();
  }

  function clear() {
    for (const ref of [paintRef, previewRef]) {
      const c = ref.current;
      c?.getContext("2d")?.clearRect(0, 0, c.width, c.height);
    }
    polyRef.current = [];
    polyActiveRef.current = false;
    lassoRef.current = [];
    setHasStrokes(false);
    onChange(null);
  }

  function selectTool(next: Tool) {
    if (polyActiveRef.current) cancelPolygon();
    setTool(next);
  }

  if (!mounted) return null;

  const toolBtn = (id: Tool, label: string, Icon: typeof Brush) => (
    <button type="button" className={`status mask-tool${tool === id ? " mask-tool-active" : ""}`} onClick={() => selectTool(id)}>
      <Icon size={14} /> {label}
    </button>
  );

  const sizeDisabled = tool === "lasso" || tool === "polygon" || tool === "pan";

  return createPortal(
    <div className="mask-modal" role="dialog" aria-modal="true" aria-label="局部重绘">
      <div className="mask-modal-backdrop" onClick={onClose} />
      <div className="mask-modal-panel">
        <div className="mask-modal-head">
          <strong>局部重绘 — 涂抹/框选要重画的区域</strong>
          <button className="status" type="button" onClick={onClose} aria-label="关闭">
            <X size={15} />
          </button>
        </div>

        <div className="mask-modal-body" ref={bodyRef}>
          <div
            className="mask-modal-stage"
            ref={stageRef}
            style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})` }}
          >
            <img src={imageSrc} alt="" className="mask-editor-image" draggable={false} />
            <canvas ref={paintRef} className="mask-editor-canvas mask-paint-canvas" />
            <canvas
              ref={previewRef}
              className={`mask-editor-canvas mask-preview-canvas${tool === "pan" || spaceHeld ? " mask-preview-pan" : ""}`}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onDoubleClick={onDoubleClick}
            />
          </div>
        </div>

        <div className="mask-modal-controls">
          {toolBtn("brush", "画笔", Brush)}
          {toolBtn("lasso", "套索", Lasso)}
          {toolBtn("polygon", "多边形", PenTool)}
          {toolBtn("eraser", "橡皮", Eraser)}
          {toolBtn("pan", "移动", Hand)}
          <label className="mask-brush">
            笔刷
            <input
              type="range"
              min={brushMin}
              max={brushMax}
              value={Math.min(brushMax, Math.max(brushMin, brush))}
              onChange={(event) => setBrush(Number(event.target.value))}
              disabled={sizeDisabled}
            />
          </label>
          <span className="mask-zoom">
            <button type="button" className="status mask-tool" onClick={() => zoomAtCenter(1 / 1.25)} aria-label="缩小">
              <ZoomOut size={14} />
            </button>
            <button
              type="button"
              className="status mask-tool mask-zoom-value"
              onClick={() => setView({ scale: 1, tx: 0, ty: 0 })}
              title="重置为适配窗口"
            >
              {Math.round(view.scale * 100)}%
            </button>
            <button type="button" className="status mask-tool" onClick={() => zoomAtCenter(1.25)} aria-label="放大">
              <ZoomIn size={14} />
            </button>
            <button
              type="button"
              className="status mask-tool"
              onClick={() => setView({ scale: 1, tx: 0, ty: 0 })}
              aria-label="适配窗口"
              title="适配窗口"
            >
              <Expand size={14} />
            </button>
          </span>
          <button type="button" className="status mask-tool" onClick={clear} disabled={!hasStrokes}>
            <Trash2 size={14} /> 清除
          </button>
          <span className="small muted mask-modal-hint">
            {tool === "polygon"
              ? "点击落点,点回起点或双击闭合"
              : tool === "pan"
                ? "拖拽平移,滚轮缩放"
                : "标红=要重画;滚轮缩放,空格/中键拖拽平移"}
          </span>
          <button type="button" className="button action-button action-save mask-modal-done" onClick={onClose}>
            <Check size={16} /> 完成
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
