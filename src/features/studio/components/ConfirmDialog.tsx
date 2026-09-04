import { X } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import { Button } from "../../../components/Button";
import { closeDialog, openDialog } from "../../../lib/dialog";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  busy?: boolean;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  busy = false,
  danger = false,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) openDialog(dialog);
    if (!open && dialog.open) closeDialog(dialog);
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="studio-confirm-dialog"
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else onCancel();
      }}
      onClose={() => {
        if (open && !busy) onCancel();
      }}
    >
      <div className="studio-confirm-header">
        <div>
          <span className="studio-kicker">确认操作</span>
          <h2>{title}</h2>
        </div>
        <button
          type="button"
          className="studio-icon-button"
          aria-label="取消"
          disabled={busy}
          onClick={onCancel}
        >
          <X aria-hidden="true" weight="bold" />
        </button>
      </div>
      {description && <p className="studio-confirm-copy">{description}</p>}
      <div className="studio-confirm-actions">
        <Button type="button" variant="quiet" disabled={busy} onClick={onCancel}>取消</Button>
        <Button
          type="button"
          variant={danger ? "secondary" : "primary"}
          className={danger ? "studio-danger-button" : ""}
          loading={busy}
          loadingLabel="正在处理"
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
