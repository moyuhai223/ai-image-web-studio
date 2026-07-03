"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Trash2, X } from "lucide-react";
import { ButtonSpinner } from "./button-spinner";

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
  /** 额外内容(如选项),渲染在描述与操作按钮之间。 */
  children?: ReactNode;
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
  children,
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
        {children ? <div className="delete-confirm-body">{children}</div> : null}
        {error ? <p className="delete-confirm-error small">{error}</p> : null}
        <div className="delete-confirm-actions">
          <button className="status action-button action-neutral" type="button" onClick={onClose} disabled={loading}>
            取消
          </button>
          <button className="button action-button action-danger" type="button" onClick={onConfirm} disabled={loading} autoFocus>
            {loading ? <ButtonSpinner size={16} /> : confirmIcon ?? <Trash2 size={16} />}
            {loading ? loadingLabel ?? confirmLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
