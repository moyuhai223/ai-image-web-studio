"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { DangerConfirmDialog } from "./danger-confirm-dialog";

/**
 * 对单张生成图做 AI 4K 高清化(以源图为参考走编辑接口在模型原生 4K 重画,runner sharp 兜底)。
 * 点「高清化」弹出与「删除」一致样式的确认弹窗(避免误触消耗额度),确认后入队,结果作为新版本进版本链。
 */
export function UpscaleButton({ imageId }: { imageId: string }) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function run() {
    setError("");
    setBusy(true);
    try {
      const response = await fetch(`/api/images/${imageId}/upscale`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "ai" })
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "高清化失败");
        return;
      }
      setConfirmOpen(false);
      setMessage("已加入队列,完成后刷新查看");
      router.refresh();
    } catch {
      setError("网络错误,请重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="upscale-menu">
      <button
        className="status action-button action-upscale"
        type="button"
        disabled={busy}
        onClick={() => {
          setError("");
          setMessage("");
          setConfirmOpen(true);
        }}
      >
        <Sparkles size={13} />
        高清化
      </button>
      {message ? <span className="small upscale-message">{message}</span> : null}
      <DangerConfirmDialog
        open={confirmOpen}
        title="确认高清化"
        description="将对这张图做 AI 4K 高清重绘:会消耗一次生成额度,且可能轻微改变画面。"
        confirmLabel="确认重绘"
        loadingLabel="提交中"
        loading={busy}
        error={error}
        icon={<Sparkles size={20} />}
        confirmIcon={<Sparkles size={16} />}
        onClose={() => {
          if (busy) return;
          setConfirmOpen(false);
        }}
        onConfirm={run}
      />
    </span>
  );
}
