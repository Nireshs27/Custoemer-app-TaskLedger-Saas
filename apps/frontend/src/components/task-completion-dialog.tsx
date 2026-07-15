import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { CheckCircle2, Loader2 } from "lucide-react";
import { invalidateAllQueries } from "@/lib/optimistic-updates";

interface TaskCompletionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityType: 'vehicle_item' | 'asset_item' | 'task_action' | 'task_action_item' | 'tax_legal_item';
  entityId: string;
  entityTitle: string;
  onSuccess?: () => void;
  onCompleteWithNotes?: (notes: string) => Promise<void>;
  confirmDisabled?: boolean;
  occurrenceKey?: string; // ✅ Add for DB-driven completion
}

export function TaskCompletionDialog({
  open,
  onOpenChange,
  entityType,
  entityId,
  entityTitle,
  onSuccess,
  onCompleteWithNotes,
  confirmDisabled = false,
  occurrenceKey, // ✅ Destructure
}: TaskCompletionDialogProps) {
  const [completionNotes, setCompletionNotes] = useState("");
  const { toast } = useToast();
  const [customPending, setCustomPending] = useState(false);
  const queryClient = useQueryClient(); // ✅ Use hook instead of global import

  const completeMutation = useMutation({
    mutationFn: async (notes: string) => {
      return apiRequest("POST", "/api/tasks/complete", {
        occurrenceKey, // ✅ Include for DB-driven completion
        entityType,
        entityId,
        completionNotes: notes,
      });
    },
    onSuccess: () => {
      toast({
        title: "Task Completed",
        description: "The task has been marked as complete and added to your history.",
      });
      
      // Use comprehensive invalidation to ensure consistency across entire app
      invalidateAllQueries(queryClient);
      
      setCompletionNotes("");
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to complete task. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleComplete = () => {
    if (onCompleteWithNotes) {
      setCustomPending(true);
      onCompleteWithNotes(completionNotes)
        .then(() => {
          toast({
            title: "Task Completed",
            description: "The task has been marked as complete and added to your history.",
          });
          invalidateAllQueries(queryClient);
          setCompletionNotes("");
          onOpenChange(false);
          onSuccess?.();
        })
        .catch((error: Error) => {
          toast({
            title: "Error",
            description: error.message || "Failed to complete task. Please try again.",
            variant: "destructive",
          });
        })
        .finally(() => setCustomPending(false));
      return;
    }
    completeMutation.mutate(completionNotes);
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setCompletionNotes("");
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md bg-white" data-testid="dialog-task-completion">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-green-600" />
            Complete Task
          </DialogTitle>
          <DialogDescription>
            Mark "{entityTitle}" as complete and add it to your task history.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="completion-notes">Completion Notes (Optional)</Label>
            <Textarea
              id="completion-notes"
              placeholder="Add any notes about how this task was completed..."
              value={completionNotes}
              onChange={(e) => setCompletionNotes(e.target.value)}
              className="min-h-[100px]"
              data-testid="textarea-completion-notes"
            />
            <p className="text-xs text-muted-foreground">
              These notes will be saved in your task history for future reference.
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={completeMutation.isPending || customPending}
            data-testid="button-cancel-completion"
          >
            Cancel
          </Button>
          <Button
            onClick={handleComplete}
            disabled={completeMutation.isPending || customPending || confirmDisabled}
            data-testid="button-confirm-completion"
          >
            {completeMutation.isPending || customPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Completing...
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4 mr-2" />
                Mark as Complete
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
