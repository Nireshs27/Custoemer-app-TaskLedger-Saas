import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreVertical, Eye, FileText, Edit, Trash2 } from "lucide-react";
import { AttachmentsModal } from "@/components/modals/attachments-modal";

type EntityCardMenuProps = {
  entityType: "property" | "vehicle" | "asset" | "task_action" | "tax_legal_compliance" | "tax_item" | "vehicle_item" | "asset_item" | "task_action_item" | "tax_legal_item";
  entityId: string;
  entityLabel?: string;
  onOverview?: () => void;
  onEdit: () => void;
  onDelete: () => void;
  disabled?: boolean;
  dataTestId?: string;
};

export function EntityCardMenu({
  entityType,
  entityId,
  entityLabel,
  onOverview,
  onEdit,
  onDelete,
  disabled = false,
  dataTestId,
}: EntityCardMenuProps) {
  const [showAttachments, setShowAttachments] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            data-entity-menu-trigger="true"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            disabled={disabled}
            data-testid={dataTestId}
          >
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
          <DropdownMenuContent 
            align="end" 
            className="w-48"
            data-entity-menu-content="true"
            onCloseAutoFocus={(e) => e.preventDefault()}
          >
            {onOverview && (
              <>
                <DropdownMenuItem 
                  onSelect={(e) => {
                    e.preventDefault();
                    onOverview();
                  }}
                >
                  <Eye className="mr-2 h-4 w-4" />
                  Overview
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem 
              onSelect={(e) => {
                e.preventDefault();
                setShowAttachments(true);
              }}
            >
              <FileText className="mr-2 h-4 w-4" />
              Attach Documents
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem 
              onSelect={(e) => {
                e.preventDefault();
                onEdit();
              }}
            >
              <Edit className="mr-2 h-4 w-4" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={(e) => {
                e.preventDefault();
                onDelete();
              }}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
      </DropdownMenu>

      {showAttachments && (
        <AttachmentsModal
          open={showAttachments}
          onOpenChange={setShowAttachments}
          entityType={entityType}
          entityId={entityId}
          entityLabel={entityLabel}
        />
      )}
    </>
  );
}
