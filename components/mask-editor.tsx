"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Brush, Check, Eraser, Trash2, X } from "lucide-react";

const MAX_SIDE = 1280; // 画布内部分辨率上限(长边)

type Point = { x: number; y: number };

type Props = {
  /** 主参考图(第一张),蒙版画在它上面 */
  imageSrc: string;
  /** 每次笔迹结束/清除时回调:有涂抹→黑白 PNG Blob(白=要改、黑=保留),无涂抹→null */
  onChange: (mask: Blob | null) => void;
  /** 关闭全屏编辑器 */
  onClose: () => void;
};

/**
 * 局部重绘蒙版编辑器(全屏弹窗):在参考图上涂抹「要重画的区域」(红色高亮),
 * 导出与画布同分辨率的**黑白** PNG —— 涂过=白(要改)、未涂=黑(保留),配合 provider 的多模态对话指令使用。
 */
export function MaskEditor({ imageSrc, onChange, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastRef = useRef<Point | null>(null);
  const [brush, setBrush] = useState(60);
  const [eraser, setEraser] = useState(false);
  const [hasStrokes, setHasStrokes] = useState(false);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Esc 关闭 + 锁定 body 滚动
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  // 载入图片拿自然尺寸,按长边限到 MAX_SIDE 设画布内部分辨率
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
    const canvas = canvasRef.current;
    if (!canvas || !dims) return;
    canvas.width = dims.w;
    canvas.height = dims.h;
    canvas.getContext("2d")?.clearRect(0, 0, dims.w, dims.h);
    setHasStrokes(false);
    onChange(null);
  }, [dims, onChange]);

  function pointerPos(event: React.PointerEvent<HTMLCanvasElement>): Point {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height
    };
  }

  function paint(from: Point, to: Point) {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.globalCompositeOperation = eraser ? "destination-out" : "source-over";
    ctx.strokeStyle = "rgba(239,68,68,0.6)";
    ctx.fillStyle = "rgba(239,68,68,0.6)";
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

  const exportMask = useCallback(() => {
    const canvas = canvasRef.current;
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
      const v = src.data[i + 3] > 10 ? 255 : 0; // 涂过 → 白(要改),未涂 → 黑(保留)
      md.data[i] = v;
      md.data[i + 1] = v;
      md.data[i + 2] = v;
      md.data[i + 3] = 255; // 不透明,纯黑白
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
    canvasRef.current?.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    const p = pointerPos(event);
    lastRef.current = p;
    paint(p, p);
  }

  function onPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    event.preventDefault();
    const p = pointerPos(event);
    paint(lastRef.current ?? p, p);
    lastRef.current = p;
  }

  function onPointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastRef.current = null;
    canvasRef.current?.releasePointerCapture(event.pointerId);
    exportMask();
  }

  function clear() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    setHasStrokes(false);
    onChange(null);
  }

  if (!mounted) return null;

  return createPortal(
    <div className="mask-modal" role="dialog" aria-modal="true" aria-label="局部重绘">
      <div className="mask-modal-backdrop" onClick={onClose} />
      <div className="mask-modal-panel">
        <div className="mask-modal-head">
          <strong>局部重绘 — 涂抹要重画的区域</strong>
          <button className="status" type="button" onClick={onClose} aria-label="关闭">
            <X size={15} />
          </button>
        </div>

        <div className="mask-modal-stage">
          <img src={imageSrc} alt="" className="mask-editor-image" draggable={false} />
          <canvas
            ref={canvasRef}
            className="mask-editor-canvas"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
        </div>

        <div className="mask-modal-controls">
          <button type="button" className={`status mask-tool${eraser ? "" : " mask-tool-active"}`} onClick={() => setEraser(false)}>
            <Brush size={14} /> 涂抹
          </button>
          <button type="button" className={`status mask-tool${eraser ? " mask-tool-active" : ""}`} onClick={() => setEraser(true)}>
            <Eraser size={14} /> 橡皮
          </button>
          <label className="mask-brush">
            笔刷
            <input type="range" min={10} max={220} value={brush} onChange={(event) => setBrush(Number(event.target.value))} />
          </label>
          <button type="button" className="status mask-tool" onClick={clear} disabled={!hasStrokes}>
            <Trash2 size={14} /> 清除
          </button>
          <span className="small muted mask-modal-hint">红色=要重画,其余保持不变</span>
          <button type="button" className="button action-button action-save mask-modal-done" onClick={onClose}>
            <Check size={16} /> 完成
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
