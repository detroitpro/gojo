import type { ReactNode } from "react";
import { Check, Trash2, X } from "lucide-react";

import { AppButton } from "@/ui/AppButton";
import { ModalDialog } from "@/ui/ModalDialog";

export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  busyLabel?: string;
  onClose: () => void;
  onConfirm: () => void;
  children?: ReactNode;
};

export function ConfirmDialog({
  open,
  title,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  busy = false,
  busyLabel = "Working…",
  onClose,
  onConfirm,
  children,
}: ConfirmDialogProps) {
  return (
    <ModalDialog
      open={open}
      title={title}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <AppButton onClick={onClose} disabled={busy} iconBefore={<X size={14} aria-hidden="true" />}>
            {cancelLabel}
          </AppButton>
          <AppButton
            variant={danger ? "danger" : "primary"}
            loading={busy}
            loadingLabel={busyLabel}
            onClick={onConfirm}
            iconBefore={
              danger ? <Trash2 size={14} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />
            }
          >
            {confirmLabel}
          </AppButton>
        </>
      }
    >
      {children}
    </ModalDialog>
  );
}
