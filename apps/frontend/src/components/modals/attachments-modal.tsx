import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EntityAttachments } from "@/components/documents/EntityAttachments";

type AttachmentsModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityType: "property" | "vehicle" | "asset" | "task_action" | "tax_legal_compliance" | "tax_item" | "vehicle_item" | "asset_item" | "task_action_item" | "tax_legal_item";
  entityId: string;
  entityLabel?: string;
};

export function AttachmentsModal({
  open,
  onOpenChange,
  entityType,
  entityId,
  entityLabel,
}: AttachmentsModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal>
      <DialogContent 
        className="max-w-3xl max-h-[85vh] overflow-y-auto"
        data-entity-modal="attachments"
      >
        <DialogHeader>
          <DialogTitle>Attachments</DialogTitle>
          {entityLabel && (
            <p className="text-sm text-muted-foreground">
              Linked to {entityLabel}
            </p>
          )}
        </DialogHeader>
        <div className="mt-4">
          <EntityAttachments
            entityType={entityType}
            entityId={entityId}
            entityLabel={entityLabel}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
