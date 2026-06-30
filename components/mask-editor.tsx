"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Brush, Check, Eraser, Lasso, Trash2, X } from "lucide-react";

const MAX_SIDE = 1600; // 画布内部分辨率上限(长边)

type Point = { x: number; y: number };
type Tool = "brush" | "lasso" | "eraser";

type Props = {
  imageSrc: string;
  onChange: (mask: Blob | null) => void;
  onClose: () => void;
};

const PAINT_COLOR = "rgba(239,68,68,0.55)";

/**
 * 局部重绘蒙版编辑器(接近全屏弹窗):
 * - 画笔:拖动涂抹;橡皮:擦除;套索:拖一圈自动填充围起来的区域。
 * - 双 canvas:底层 paint(已提交的蒙版,红色) + 顶层 preview(套索实时轮廓)。
 * - 导出黑白 PNG(涂过=白=要改、未涂=黑=保留),配合 provider 的多模态对话指令。
 */
export function MaskEditor({ imageSrc, onChange, onClose }: Props) {
  const paintRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastRef = useRef<Point | null>(null);
  const lassoRef = useRef<Point[]>([]);
  const [tool, setTool] = useState<Tool>("brush");
  const [brush, setBrush] = useState(70);
  const [hasStrokes, setHasStrokes] = useState(false);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
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

  function drawLassoPreview() {
    const ctx = previewRef.current?.getContext("2d");
    const pts = lassoRef.current;
    if (!ctx) return;
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    if (pts.length < 2) return;
    ctx.lineWidth = Math.max(2, ctx.canvas.width / 400);
    ctx.strokeStyle = "rgba(239,68,68,0.95)";
    ctx.setLineDash([ctx.lineWidth * 3, ctx.lineWidth * 3]);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function commitLasso() {
    const ctx = paintRef.current?.getContext("2d");
    const pts = lassoRef.current;
    const preview = previewRef.current?.getContext("2d");
    preview?.clearRect(0, 0, preview.canvas.width, preview.canvas.height);
    lassoRef.current = [];
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
      const v = src.data[i + 3] > 10 ? 255 : 0; // 涂过 → 白(改),未涂 → 黑(留)
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

  function onPointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    event.preventDefault();
    previewRef.current?.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    const p = pointerPos(event);
    lastRef.current = p;
    if (tool === "lasso") {
      lassoRef.current = [p];
      drawLassoPreview();
    } else {
      paintBrush(p, p, tool === "eraser");
    }
  }

  function onPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    event.preventDefault();
    const p = pointerPos(event);
    if (tool === "lasso") {
      lassoRef.current.push(p);
      drawLassoPreview();
    } else {
      paintBrush(lastRef.current ?? p, p, tool === "eraser");
    }
    lastRef.current = p;
  }

  function onPointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastRef.current = null;
    previewRef.current?.releasePointerCapture(event.pointerId);
    if (tool === "lasso") commitLasso();
    exportMask();
  }

  function clear() {
    for (const ref of [paintRef, previewRef]) {
      const c = ref.current;
      c?.getContext("2d")?.clearRect(0, 0, c.width, c.height);
    }
    lassoRef.current = [];
    setHasStrokes(false);
    onChange(null);
  }

  if (!mounted) return null;

  const toolBtn = (id: Tool, label: string, Icon: typeof Brush) => (
    <button type="button" className={`status mask-tool${tool === id ? " mask-tool-active" : ""}`} onClick={() => setTool(id)}>
      <Icon size={14} /> {label}
    </button>
  );

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
            />
          </div>
        </div>

        <div className="mask-modal-controls">
          {toolBtn("brush", "画笔", Brush)}
          {toolBtn("lasso", "套索", Lasso)}
          {toolBtn("eraser", "橡皮", Eraser)}
          <label className="mask-brush">
            笔刷
            <input type="range" min={10} max={260} value={brush} onChange={(event) => setBrush(Number(event.target.value))} disabled={tool === "lasso"} />
          </label>
          <button type="button" className="status mask-tool" onClick={clear} disabled={!hasStrokes}>
            <Trash2 size={14} /> 清除
          </button>
          <span className="small muted mask-modal-hint">画笔/套索标红=要重画,其余保持不变</span>
          <button type="button" className="button action-button action-save mask-modal-done" onClick={onClose}>
            <Check size={16} /> 完成
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
