"use client";

import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { copy } from "@/content/fr";

type Props = {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  pending?: boolean;
  pendingLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = copy.admin.confirm.cancel,
  pending = false,
  pendingLabel,
  danger = false,
  onConfirm,
  onClose,
}: Props) {
  return (
    <Dialog open={open} title={title} onClose={onClose}>
      <p className="text-content-muted">{body}</p>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={pending}>
          {cancelLabel}
        </Button>
        <Button
          variant={danger ? "danger" : "primary"}
          pending={pending}
          onClick={onConfirm}
        >
          {pending ? pendingLabel ?? confirmLabel : confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
