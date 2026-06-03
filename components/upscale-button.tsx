"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Wand2, X, ZoomIn } from "lucide-react";

/**
 * 对单张生成图做 4K 高清化。点「高清化」就地展开两种方式:
 * - 快速放大:sharp 插值放大,同步秒出;
 * - AI 高清重绘:走队列以源图为参考重画 + 收尾到 4K。
 * 结果都会作为该图的新版本进版本链,刷新后可见。就地展开避免绝对定位弹层在卡片里被裁剪。
 */
export function UpscaleButton({ imageId }: { imageId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"" | "fast" | "ai">("");
  const [message, setMessage] = useState("");

  async function run(mode: "fast" | "ai") {
    setBusy(mode);
    setMessage("");
    try {
      const response = await fetch(`/api/images/${imageId}/upscale`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode })
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setMessage(data.error ?? "高清化失败");
        return;
      }
      if (mode === "ai") {
        setMessage("已加入队列,完成后刷新查看");
      } else {
        setOpen(false);
      }
      router.refresh();
    } catch {
      setMessage("网络错误,请重试");
    } finally {
      setBusy("");
    }
  }

  if (!open) {
    return (
      <button
        className="status action-button action-upscale"
        type="button"
        onClick={() => {
          setOpen(true);
          setMessage("");
        }}
      >
        <Sparkles size={13} />
        高清化
      </button>
    );
  }

  return (
    <span className="upscale-menu">
      <button
        className="status action-button action-upscale"
        type="button"
        disabled={busy !== ""}
        onClick={() => run("fast")}
      >
        <ZoomIn size={13} />
        {busy === "fast" ? "处理中…" : "快速放大 4K"}
      </button>
      <button
        className="status action-button action-rerun"
        type="button"
        disabled={busy !== ""}
        onClick={() => run("ai")}
      >
        <Wand2 size={13} />
        {busy === "ai" ? "提交中…" : "AI 高清重绘"}
      </button>
      <button
        className="status"
        type="button"
        aria-label="取消"
        disabled={busy !== ""}
        onClick={() => {
          setOpen(false);
          setMessage("");
        }}
      >
        <X size={13} />
      </button>
      {message ? <span className="small upscale-message">{message}</span> : null}
    </span>
  );
}
