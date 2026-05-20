"use client";

import { Ban, RotateCcw } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { DangerConfirmDialog } from "./danger-confirm-dialog";

type JobControlAction = "cancel" | "requeue";

type Props = {
  action: JobControlAction;
  recordId: string;
  onDone?: () => void;
};

const labels = {
  cancel: {
    idle: "取消",
    loading: "取消中",
    title: "确认取消任务",
    description: "已发出的模型请求可能会先返回，但不会继续保存后续图片。",
    confirmLabel: "取消任务"
  },
  requeue: {
    idle: "重试",
    loading: "重试中",
    title: "确认重新排队",
    description: "已保存的失败残留图片会先清理，然后任务会重新进入队列。",
    confirmLabel: "重新排队"
  }
};

export function JobControlButton({ action, recordId, onDone }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState("");
  const copy = labels[action];

  function openConfirm() {
    setError("");
    setConfirmOpen(true);
  }

  function closeConfirm() {
    if (loading) return;
    setConfirmOpen(false);
    setError("");
  }

  async function runAction() {
    setError("");
    setLoading(true);
    const response = await fetch(`/api/records/${recordId}/control`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action })
    });
    setLoading(false);

    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "操作失败");
      return;
    }

    setConfirmOpen(false);
    onDone?.();
    router.refresh();
  }

  return (
    <>
      <button className={`status ${action === "cancel" ? "failed" : "queued"}`} type="button" disabled={loading} onClick={openConfirm}>
        {action === "cancel" ? <Ban size={13} /> : <RotateCcw size={13} />}
        {loading ? copy.loading : copy.idle}
      </button>
      <DangerConfirmDialog
        open={confirmOpen}
        title={copy.title}
        description={copy.description}
        confirmLabel={copy.confirmLabel}
        loadingLabel={copy.loading}
        loading={loading}
        error={error}
        confirmIcon={action === "cancel" ? <Ban size={16} /> : <RotateCcw size={16} />}
        onClose={closeConfirm}
        onConfirm={runAction}
      />
    </>
  );
}
