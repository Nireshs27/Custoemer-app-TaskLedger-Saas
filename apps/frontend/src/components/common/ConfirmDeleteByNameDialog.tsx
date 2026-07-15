import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface ConfirmDeleteByNameDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
  entityLabel: string;
  entityName: string;
}

export function ConfirmDeleteByNameDialog({
  open,
  onClose,
  onConfirm,
  entityLabel,
  entityName,
}: ConfirmDeleteByNameDialogProps) {
  const [typedValue, setTypedValue] = useState("");
  const [loading, setLoading] = useState(false);

  const normalize = (value: string) =>
    value.replace(/\s+/g, " ").trim();

  useEffect(() => {
    if (!open) {
      setTypedValue("");
      setLoading(false);
    }
  }, [open]);

  const normalizedInput = normalize(typedValue);
  const normalizedEntityName = normalize(entityName);
  const hasValidEntityName = normalizedEntityName.length > 0;
  const exactMatch =
    hasValidEntityName &&
    normalizedInput.length > 0 &&
    normalizedInput === normalizedEntityName;

  const handleConfirm = async () => {
    if (!exactMatch || loading) {
      return;
    }
    try {
      setLoading(true);
      await onConfirm();
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent data-testid="confirm-delete-dialog">
        <DialogHeader>
          <DialogTitle>Delete {entityLabel}</DialogTitle>
          <DialogDescription>
            This action cannot be undone. To confirm, type the exact{" "}
            {entityLabel.toLowerCase()} name:
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {hasValidEntityName ? (
            <>
              <div className="rounded border bg-muted px-3 py-2 font-mono text-sm" data-testid="delete-expected-text">
                {entityName}
              </div>
              <Input
                autoFocus
                placeholder={`Type "${entityName}" to confirm`}
                value={typedValue}
                onChange={(event) => setTypedValue(event.target.value)}
                data-testid="confirm-delete-input"
              />
            </>
          ) : (
            <div className="rounded border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="delete-missing-name-warning">
              Unable to confirm delete: missing name
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={!exactMatch || loading}
            data-testid="confirm-delete-button"
          >
            {loading ? "Deleting..." : `Delete ${entityLabel}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


