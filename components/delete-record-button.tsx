"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { ButtonSpinner } from "./button-spinner";
import { DangerConfirmDialog } from "./danger-confirm-dialog";

export function DeleteRecordButton({
  recordId,
  redirectTo,
  onDeleted
}: {
  recordId: string;
  redirectTo?: string;
  onDeleted?: () => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState("");

  function openConfirm() {
    setError("");
    setConfirmOpen(true);
  }

  function closeConfirm() {
    if (loading) return;
    setConfirmOpen(false);
    setError("");
  }

  async function removeRecord() {
    setError("");
    setLoading(true);
    const response = await fetch(`/api/records/${recordId}`, { method: "DELETE" });
    setLoading(false);

    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "删除失败");
      return;
    }

    setConfirmOpen(false);
    onDeleted?.();
    if (redirectTo) {
      router.replace(redirectTo);
      router.refresh();
      return;
    }

    router.refresh();
  }

  return (
    <>
      <button className="status action-button action-danger" type="button" disabled={loading} onClick={openConfirm}>
        {loading ? <ButtonSpinner /> : <Trash2 size={13} />}
        {loading ? "删除中" : "删除"}
      </button>
      <DangerConfirmDialog
        open={confirmOpen}
        title="确认删除记录"
        description="这会同时删除数据库记录和本地生成图片，操作不可恢复。"
        confirmLabel="删除记录"
        loadingLabel="删除中"
        loading={loading}
        error={error}
        onClose={closeConfirm}
        onConfirm={removeRecord}
      />
    </>
  );
}
