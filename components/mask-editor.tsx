"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Brush, Check, Eraser, Lasso, PenTool, Trash2, X } from "lucide-react";

const MAX_SIDE = 1600; // 画布内部分辨率上限(长边)

type Point = { x: number; y: number };
type Tool = "brush" | "lasso" | "polygon" | "eraser";

type Props = {
  imageSrc: string;
  onChange: (mask: Blob | null) => void;
  onClose: () => void;
};

const PAINT_COLOR = "rgba(239,68,68,0.55)";
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * 局部重绘蒙版编辑器(近全屏弹窗):
 * - 画笔:拖动涂抹;橡皮:擦除;套索:拖一圈自动填充;多边形:点击落点、点回起点/双击闭合填充。
 * - 笔刷默认大小随图自适应。双 canvas:底层 paint(已提交蒙版,红) + 顶层 preview(套索/多边形实时轮廓)。
 * - 导出黑白 PNG(涂过=白=要改、未涂=黑=保留)。
 */
export function MaskEditor({ imageSrc, onChange, onClose }: Props) {
  const paintRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastRef = useRef<Point | null>(null);
  const lassoRef = useRef<Point[]>([]);
  const polyRef = useRef<Point[]>([]);
  const polyActiveRef = useRef(false);
  const [tool, setTool] = useState<Tool>("brush");
  const [brush, setBrush] = useState(80);
  const [hasStrokes, setHasStrokes] = useState(false);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [mounted, setMounted] = useState(false);

  const maxDim = dims ? Math.max(dims.w, dims.h) : 1000;
  const brushMin = Math.max(6, Math.round(maxDim * 0.008));
  const brushMax = Math.max(120, Math.round(maxDim * 0.4));
  const closeThreshold = maxDim * 0.025;
  const previewLine = Math.max(2, Math.round(maxDim / 400));

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // 多边形进行中:Esc 先取消当前多边形,否则关闭弹窗
      if (polyActiveRef.current) {
        cancelPolygon();
      } else {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose]);

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

  function onPointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    event.preventDefault();
    const p = pointerPos(event);

    if (tool === "polygon") {
      const pts = polyRef.current;
      if (pts.length >= 3 && dist(p, pts[0]) <= closeThreshold) {
        commitPolygon();
      } else {
        pts.push(p);
        polyActiveRef.current = true;
        drawOutline(pts, p, false);
      }
      return;
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

  const sizeDisabled = tool === "lasso" || tool === "polygon";

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

        <div className="mask-modal-body">
          <div className="mask-modal-stage">
            <img src={imageSrc} alt="" className="mask-editor-image" draggable={false} />
            <canvas ref={paintRef} className="mask-editor-canvas mask-paint-canvas" />
            <canvas
              ref={previewRef}
              className="mask-editor-canvas mask-preview-canvas"
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
          <button type="button" className="status mask-tool" onClick={clear} disabled={!hasStrokes}>
            <Trash2 size={14} /> 清除
          </button>
          <span className="small muted mask-modal-hint">
            {tool === "polygon" ? "点击落点,点回起点或双击闭合" : "标红=要重画,其余保持不变"}
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
