import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CheckCircle2, MoreVertical, Trash2, Edit, FileText } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TaskCompletionDialog } from "@/components/task-completion-dialog";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  optimisticDeleteVehicleItem,
  optimisticDeleteAssetItem,
  optimisticDeleteTaskActionItem,
  optimisticDeleteTaxLegalItem,
  rollbackVehicleItemQueries,
  rollbackAssetItemQueries,
  rollbackTaskActionItemQueries,
  rollbackTaxLegalItemQueries,
  invalidateAllQueries,
} from "@/lib/optimistic-updates";
import { ConfirmDeleteByNameDialog } from "@/components/common/ConfirmDeleteByNameDialog";
import { AttachmentsModal } from "@/components/modals/attachments-modal";

interface TaskActionMenuProps {
  entityType: 'tax_item' | 'vehicle_item' | 'asset_item' | 'task_action' | 'task_action_item' | 'tax_legal_item';
  entityId: string;
  entityTitle: string;
  status?: string;
  variant?: 'icon' | 'button';
  isRecurring?: boolean;
  recurrenceData?: any;
  recurrenceDataJson?: any;
  occurrenceKey?: string;
  hideDelete?: boolean;
  onSuccess?: () => void;
  onEdit?: () => void;
  parentId?: string; // ⚡ Parent ID for optimistic delete (vehicleId, assetId, taskActionId, complianceId)
}

export function shouldHideTaskMenu(
  status: string | undefined,
  isRecurring?: boolean,
  recurrenceData?: any,
  recurrenceDataJson?: any
): boolean {
  const isRecurringTask =
    Boolean(isRecurring) || Boolean(recurrenceData) || Boolean(recurrenceDataJson);
  return status === "completed" && !isRecurringTask;
}

export function TaskActionMenu({
  entityType,
  entityId,
  entityTitle,
  status = 'pending',
  variant = 'icon',
  isRecurring,
  recurrenceData,
  recurrenceDataJson,
  occurrenceKey,
  hideDelete = false,
  onSuccess,
  onEdit,
  parentId
}: TaskActionMenuProps) {
  const [completionDialogOpen, setCompletionDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const { toast } = useToast();

  const entityLabel =
    entityType === "tax_item"
      ? "Tax Task"
      : entityType === "tax_legal_item"
      ? "Tax & Legal Task"
      : entityType === "vehicle_item"
      ? "Vehicle Task"
      : entityType === "asset_item"
      ? "Asset Item"
      : entityType === "task_action"
      ? "Task Action"
      : entityType === "task_action_item"
      ? "Task Action Item"
      : "Task";

  const handleCompleteClick = () => {
    setCompletionDialogOpen(true);
  };

  const handleCompletionSuccess = () => {
    onSuccess?.();
  };

  const handleDeleteClick = () => {
    setDeleteDialogOpen(true);
  };

  // ⚡ Fetch vehicle item data ONLY if parentId not provided (backward compatibility)
  const { data: vehicleItemData } = useQuery({
    queryKey: ["/api/vehicle-items"],
    enabled: entityType === 'vehicle_item' && !parentId,
  });

  // Delete mutation with optimistic updates
  type DeleteMutationContext = {
    previousData?: unknown;
    assetId?: string;
    taskActionId?: string;
    complianceId?: string;
  };

  const deleteMutation = useMutation<
    unknown,
    Error,
    void,
    DeleteMutationContext
  >({
    mutationFn: async () => {
      const endpoint = entityType === 'vehicle_item' ? '/api/vehicle-items' :
                      entityType === 'asset_item' ? '/api/asset-items' :
                      entityType === 'tax_legal_item' ? '/api/tax-legal-items' :
                      entityType === 'task_action_item' ? '/api/task-action-items' :
                      '/api/task-actions';
      return apiRequest("DELETE", `${endpoint}/${entityId}`, undefined);
    },
    // ⚡ Lightning-fast optimistic delete for ALL task types
    onMutate: async () => {
      let context: DeleteMutationContext | undefined = undefined;

      // ✅ Use parentId if provided (preferred), else fallback to querying
      if (entityType === 'vehicle_item') {
        const vehicleId = parentId || 
          (Array.isArray(vehicleItemData) && vehicleItemData.find((item: any) => item.id === entityId)?.vehicleId);
        
        if (vehicleId) {
          context = await optimisticDeleteVehicleItem(queryClient, entityId, vehicleId);
        }
      } else if (entityType === 'asset_item' && parentId) {
        const result = await optimisticDeleteAssetItem(queryClient, entityId, parentId);
        context = { ...result, assetId: parentId };
      } else if (entityType === 'task_action_item' && parentId) {
        const result = await optimisticDeleteTaskActionItem(queryClient, entityId, parentId);
        context = { ...result, taskActionId: parentId };
      } else if (entityType === 'tax_legal_item' && parentId) {
        const result = await optimisticDeleteTaxLegalItem(queryClient, entityId, parentId);
        context = { ...result, complianceId: parentId };
      }

      // Close dialog immediately for lightning-fast UX (all types now)
      if (context) {
        setDeleteDialogOpen(false);
        onSuccess?.();
      }
      
      return context;
    },
    onSuccess: () => {
      toast({
        title: "Deleted",
        description: `${entityTitle} has been deleted successfully.`,
      });
      
      // Use comprehensive invalidation to ensure consistency across entire app
      invalidateAllQueries(queryClient);
      
      // Dialog already closed optimistically for all types with optimistic delete
      // Only close if optimistic delete didn't run
      const hasOptimisticDelete = ['vehicle_item', 'asset_item', 'task_action_item', 'tax_legal_item'].includes(entityType);
      if (!hasOptimisticDelete) {
        setDeleteDialogOpen(false);
        onSuccess?.();
      }
    },
    onError: (error: Error, _data, context) => {
      // ⚡ Rollback optimistic delete for ALL task types
      if (entityType === 'vehicle_item' && context?.previousData) {
        rollbackVehicleItemQueries(queryClient, context.previousData);
      } else if (entityType === 'asset_item' && context?.previousData && context?.assetId) {
        rollbackAssetItemQueries(queryClient, context.previousData, context.assetId);
      } else if (entityType === 'task_action_item' && context?.previousData && context?.taskActionId) {
        rollbackTaskActionItemQueries(queryClient, context.previousData, context.taskActionId);
      } else if (entityType === 'tax_legal_item' && context?.previousData && context?.complianceId) {
        rollbackTaxLegalItemQueries(queryClient, context.previousData, context.complianceId);
      }
      
      toast({
        title: "Error",
        description: error.message || "Failed to delete. Please try again.",
        variant: "destructive",
      });
    },
    onSettled: () => {
      // Final sync with server - comprehensive invalidation
      invalidateAllQueries(queryClient);
    },
  });

  // Determine visibility of menu items based on status and recurrence
  const isCompleted = status === 'completed';
  
  const canEdit = true; // Edit is now enabled
  const canComplete = !isCompleted;
  const canDelete = !hideDelete; // Delete can be hidden via prop (used in Dashboard widget)

  if (variant === 'button') {
    return (
      <>
        {canComplete && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleCompleteClick}
            data-testid={`complete-button-${entityId}`}
            className="bg-white hover:bg-gray-50"
          >
            <CheckCircle2 className="mr-2 h-4 w-4" />
            Mark Complete
          </Button>
        )}

        {canComplete && (
          <TaskCompletionDialog
            open={completionDialogOpen}
            onOpenChange={setCompletionDialogOpen}
            entityType={entityType}
            entityId={entityId}
            entityTitle={entityTitle}
            occurrenceKey={occurrenceKey}
            onSuccess={handleCompletionSuccess}
          />
        )}
      </>
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            data-testid={`menu-trigger-${entityId}`}
          >
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canEdit && (
            <DropdownMenuItem
              onClick={() => onEdit?.()}
              data-testid={`edit-action-${entityId}`}
            >
              <Edit className="mr-2 h-4 w-4" />
              Edit
            </DropdownMenuItem>
          )}
          {canEdit && canComplete && <DropdownMenuSeparator />}
          <DropdownMenuItem
            onClick={() => setAttachmentsOpen(true)}
            data-testid={`attachments-action-${entityId}`}
          >
            <FileText className="mr-2 h-4 w-4" />
            Attach Documents
          </DropdownMenuItem>
          {canComplete && <DropdownMenuSeparator />}
          {canComplete && (
            <DropdownMenuItem
              onClick={handleCompleteClick}
              data-testid={`complete-action-${entityId}`}
            >
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Mark as Complete
            </DropdownMenuItem>
          )}
          {canComplete && canDelete && <DropdownMenuSeparator />}
          {canDelete && (
            <DropdownMenuItem
              onClick={handleDeleteClick}
              data-testid={`delete-action-${entityId}`}
              className="text-destructive"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {canComplete && (
        <TaskCompletionDialog
          open={completionDialogOpen}
          onOpenChange={setCompletionDialogOpen}
          entityType={entityType}
          entityId={entityId}
          entityTitle={entityTitle}
          occurrenceKey={occurrenceKey}
          onSuccess={handleCompletionSuccess}
        />
      )}

      {canDelete && (
        <ConfirmDeleteByNameDialog
          open={deleteDialogOpen}
          onClose={() => setDeleteDialogOpen(false)}
          entityLabel={entityLabel}
          entityName={entityTitle}
          onConfirm={async () => {
            await deleteMutation.mutateAsync();
          }}
        />
      )}

      {attachmentsOpen && (
        <AttachmentsModal
          open={attachmentsOpen}
          onOpenChange={setAttachmentsOpen}
          entityType={entityType as any}
          entityId={entityId}
          entityLabel={entityTitle}
        />
      )}
    </>
  );
}

