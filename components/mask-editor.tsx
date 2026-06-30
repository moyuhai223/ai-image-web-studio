"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Brush, Eraser, Trash2 } from "lucide-react";

const MAX_SIDE = 1024; // 画布内部分辨率上限(长边),够细 + 导出小

type Point = { x: number; y: number };

type Props = {
  /** 主参考图(第一张),蒙版画在它上面 */
  imageSrc: string;
  /** 每次笔迹结束/清除时回调:有涂抹→alpha PNG Blob(透明=要改),无涂抹→null */
  onChange: (mask: Blob | null) => void;
};

/**
 * 局部重绘蒙版编辑器:在参考图上叠一层 canvas,涂抹「要重画的区域」(红色),
 * 导出与画布同分辨率、带 alpha 的 PNG —— 涂过处 alpha=0(透明=编辑,OpenAI 标准),其余 alpha=255(保留)。
 * 服务端再把该蒙版缩放到与处理后参考图等尺寸。
 */
export function MaskEditor({ imageSrc, onChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastRef = useRef<Point | null>(null);
  const [brush, setBrush] = useState(48);
  const [eraser, setEraser] = useState(false);
  const [hasStrokes, setHasStrokes] = useState(false);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

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

  // 尺寸就绪/变化时重置画布(换参考图也走这里)
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
    ctx.strokeStyle = "rgba(239,68,68,0.55)";
    ctx.fillStyle = "rgba(239,68,68,0.55)";
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
      if (src.data[i + 3] > 10) {
        // 涂过 → 透明(alpha=0 = 要重绘)
        md.data[i + 3] = 0;
        painted += 1;
      } else {
        // 未涂 → 不透明黑(alpha=255 = 保留)
        md.data[i + 3] = 255;
      }
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

  return (
    <div className="mask-editor">
      <div className="mask-editor-stage">
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
      <div className="mask-editor-controls">
        <button type="button" className={`status mask-tool${eraser ? "" : " mask-tool-active"}`} onClick={() => setEraser(false)}>
          <Brush size={13} /> 涂抹
        </button>
        <button type="button" className={`status mask-tool${eraser ? " mask-tool-active" : ""}`} onClick={() => setEraser(true)}>
          <Eraser size={13} /> 橡皮
        </button>
        <label className="mask-brush">
          笔刷
          <input type="range" min={8} max={160} value={brush} onChange={(event) => setBrush(Number(event.target.value))} />
        </label>
        <button type="button" className="status mask-tool" onClick={clear} disabled={!hasStrokes}>
          <Trash2 size={13} /> 清除
        </button>
      </div>
      <p className="small muted">在参考图上涂抹要<strong>重新绘制</strong>的区域(红色),其余保持不变。蒙版作用于第一张参考图。</p>
    </div>
  );
}
