"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Trash2, X } from "lucide-react";

type DangerConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  loadingLabel?: string;
  loading?: boolean;
  error?: string;
  icon?: ReactNode;
  confirmIcon?: ReactNode;
  onClose: () => void;
  onConfirm: () => void;
};

export function DangerConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  loadingLabel,
  loading = false,
  error,
  icon,
  confirmIcon,
  onClose,
  onConfirm
}: DangerConfirmDialogProps) {
  const titleId = useId();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !loading) {
        onClose();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [loading, onClose, open]);

  if (!open || !mounted) return null;

  return createPortal(
    <div className="delete-confirm-overlay" role="presentation" onClick={onClose}>
      <div
        className="delete-confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="delete-confirm-head">
          <span className="delete-confirm-icon" aria-hidden="true">
            {icon ?? <AlertTriangle size={20} />}
          </span>
          <div>
            <h2 id={titleId}>{title}</h2>
            <p>{description}</p>
          </div>
          <button className="delete-confirm-close" type="button" onClick={onClose} disabled={loading} aria-label="关闭">
            <X size={17} />
          </button>
        </div>
        {error ? <p className="delete-confirm-error small">{error}</p> : null}
        <div className="delete-confirm-actions">
          <button className="status" type="button" onClick={onClose} disabled={loading}>
            取消
          </button>
          <button className="button danger" type="button" onClick={onConfirm} disabled={loading} autoFocus>
            {confirmIcon ?? <Trash2 size={16} />}
            {loading ? loadingLabel ?? confirmLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
