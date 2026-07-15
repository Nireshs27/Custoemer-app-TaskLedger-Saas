import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar, AlertTriangle, CheckCircle, Clock, Plus, X } from "lucide-react";
import { format, isPast, isFuture } from "date-fns";
import { cn } from "@/lib/utils";
import type { TaskActionItem } from "@shared/schema";
import { ReminderDisplay } from "@/components/reminder-display";
import { getEffectiveDueDate } from "@/lib/effective-due-date";
import { VehicleItemCreateDialog } from "@/components/vehicle-item-create-dialog";
import { TaskActionMenu } from "@/components/task-action-menu";
import { buildSummary, getSummaryStatus } from "@/lib/entity-summary";
import { getSummaryBadges } from "@/lib/summary-badges";

type TaskActionItemsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskActionId: string;
  taskActionTitle: string;
  createdAt?: string | Date;
  priority?: string;
};

export function TaskActionItemsDialog({
  open,
  onOpenChange,
  taskActionId,
  taskActionTitle,
  createdAt,
  priority,
}: TaskActionItemsDialogProps) {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const itemsQueryKey = [`/api/task-actions/${taskActionId}/tasks`];

  const getPriorityBadgeStyle = (priority?: string) => {
    const p = priority?.toLowerCase() || "medium";
    switch (p) {
      case "high":
        return { label: "High", className: "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800" };
      case "low":
        return { label: "Low", className: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800" };
      default:
        return { label: "Medium", className: "bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-300 dark:border-yellow-800" };
    }
  };

  const priorityStyle = getPriorityBadgeStyle(priority);

  const { data: items = [], isLoading } = useQuery<TaskActionItem[]>({
    queryKey: itemsQueryKey,
    enabled: open,
  });

  // ✅ Always get fresh editing item from cache (prevents stale data)
  const editingItem = editingItemId ? items.find(item => item.id === editingItemId) : null;

  const summary = useMemo(() => buildSummary(items), [items]);
  const summaryStatus = getSummaryStatus(summary);
  const SummaryStatusIcon = summaryStatus.icon;

  const getStatusInfo = (item: any) => {
    // PRIMARY: Use occurrenceSummary if available
    if (item.occurrenceSummary) {
      const s = item.occurrenceSummary;
      const overdue = s.overdueCount ?? 0;
      const today = s.dueTodayCount ?? 0;
      const upcoming = s.upcomingCount ?? 0;
      
      if (item.status === 'completed') {
        return { 
          icon: CheckCircle, 
          color: 'text-green-600 bg-green-50 dark:bg-green-950',
        };
      }
      
      // Determine icon by priority
      if (overdue > 0) {
        return { 
          icon: AlertTriangle, 
          color: 'text-red-600 bg-red-50 dark:bg-red-950',
        };
      }
      
      if (today > 0) {
        return { 
          icon: Clock, 
          color: 'text-orange-600 bg-orange-50 dark:bg-orange-950',
        };
      }
      
      if (upcoming > 0) {
        return { 
          icon: Clock, 
          color: 'text-blue-600 bg-blue-50 dark:bg-blue-950',
        };
      }
      
      return { 
        icon: CheckCircle, 
        color: 'text-green-600 bg-green-50 dark:bg-green-950',
      };
    }
    
    // FALLBACK: Old logic for backward compatibility
    const eff = getEffectiveDueDate(item as any);
    const dueDate = eff ?? new Date(item.dueDate as any);

    if (item.status === "completed") {
      return {
        icon: CheckCircle,
        color: "text-green-600 bg-green-50 dark:bg-green-950",
      };
    }

    if (isPast(dueDate) && item.status === "pending") {
      return {
        icon: AlertTriangle,
        color: "text-red-600 bg-red-50 dark:bg-red-950",
      };
    }

    if (isFuture(dueDate)) {
      return {
        icon: Clock,
        color: "text-blue-600 bg-blue-50 dark:bg-blue-950",
      };
    }

    return {
      icon: Clock,
      color: "text-yellow-600 bg-yellow-50 dark:bg-yellow-950",
    };
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col rounded-2xl [&>button]:hidden">
        {/* Modern header with title and action buttons */}
        <DialogHeader className="space-y-0 pb-4">
          <div className="flex flex-wrap items-start sm:items-center justify-between gap-3 sm:gap-4">
            {/* Title */}
            <div className="space-y-1 min-w-0 flex-1">
              <Badge variant="outline" className={cn("px-2 py-0 text-[10px] font-semibold uppercase tracking-wider", priorityStyle.className)}>
                {priorityStyle.label} Priority
              </Badge>
              <DialogTitle className="text-xl sm:text-2xl font-semibold">Tasks for {taskActionTitle}</DialogTitle>
              {createdAt && (
                <div className="flex items-center text-sm text-muted-foreground">
                  <Calendar className="w-4 h-4 mr-2" />
                  Created: {format(new Date(createdAt), "MMM d, yyyy")}
                </div>
              )}
            </div>
            
            {/* Action buttons */}
            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto sm:flex-shrink-0">
              <Button
                variant="outline"
                size="default"
                onClick={() => onOpenChange(false)}
                className="rounded-full px-4 py-2 bg-gray-100 text-black border-0 hover:bg-gray-200 min-h-[44px] flex-1 sm:flex-none"
              >
                <X className="h-4 w-4 mr-2" />
                Close
              </Button>
              <Button
                onClick={() => setCreateDialogOpen(true)}
                size="default"
                className="rounded-full px-4 py-2 bg-teal-600 text-white hover:bg-teal-700 border-0 min-h-[44px] flex-1 sm:flex-none"
                data-testid="add-task-action-item"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Task
              </Button>
            </div>
          </div>
          
          {/* Subtitle */}
          <DialogDescription className="text-sm text-muted-foreground pt-2">
            View and manage all tasks for this task action
          </DialogDescription>
        </DialogHeader>

        {/* Summary row + Next task field */}
        <div className="space-y-3 pb-4">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <SummaryStatusIcon className="w-4 h-4" />
              <span>{summary.itemsCount} items</span>
            </div>
          </div>
          
          {summary.nextDueItem && (
            <div className="bg-muted/30 rounded-xl px-4 py-3 text-sm text-muted-foreground border border-border/60">
              {(() => {
                const nextTitle =
                  summary.nextDueItem.title ||
                  (summary.nextDueItem as any).description ||
                  (summary.nextDueItem as any).notes ||
                  "—";

                const nextDate = summary.nextDueItem.dueDate
                  ? format(new Date(summary.nextDueItem.dueDate as any), "MMM d")
                  : null;

                return (
                  <>
                    <span className="font-medium">Next:</span> {nextTitle}
                    {nextDate ? ` (${nextDate})` : ""}
                  </>
                );
              })()}
            </div>
          )}
        </div>

        {/* Scrollable task list */}
        <div className="flex-1 overflow-y-auto space-y-4 pr-2">
          {isLoading ? (
            <>
              {[...Array(3)].map((_, i) => (
                <Card key={i} className="rounded-2xl shadow-none border">
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between">
                      <div className="space-y-2 flex-1">
                        <div className="h-4 w-48 bg-muted animate-pulse rounded" />
                        <div className="h-3 w-32 bg-muted animate-pulse rounded" />
                      </div>
                      <div className="h-8 w-8 bg-muted animate-pulse rounded-full" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </>
          ) : items.length === 0 ? (
            <Card className="rounded-2xl shadow-none border">
              <CardContent className="p-8 text-center text-muted-foreground">
                No tasks found for this task action
              </CardContent>
            </Card>
          ) : (
            items.map((item) => {
              const statusInfo = getStatusInfo(item);
              const StatusIcon = statusInfo.icon;

              return (
                <Card 
                  key={item.id} 
                  className="m-2 sm:m-4 p-4 sm:p-6 rounded-3xl bg-white border shadow-none transition-shadow duration-200"
                >
                  <CardContent className="p-6">
                    <div className="flex items-start gap-4">
                      {/* Status icon */}
                      <div
                        className={cn(
                          "w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0",
                          statusInfo.color
                        )}
                      >
                        <StatusIcon className="w-5 h-5" />
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0 space-y-3">
                        {/* Title row */}
                        <div className="flex items-start justify-between gap-3">
                          <h4 className="font-semibold text-lg text-foreground leading-tight">{item.title}</h4>
                          <div className="flex flex-wrap items-center justify-end gap-1.5">
                            {item.status === 'completed' ? (
                              <Badge 
                                variant="outline" 
                                className="capitalize rounded-full px-3 py-1 text-xs font-semibold shrink-0 bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300"
                              >
                                Completed
                              </Badge>
                            ) : (item as any).occurrenceSummary ? (
                              getSummaryBadges({
                                overdueCount: (item as any).occurrenceSummary.overdueCount,
                                dueTodayCount: (item as any).occurrenceSummary.dueTodayCount,
                                upcomingCount: (item as any).occurrenceSummary.upcomingCount,
                              }).map((badge) => (
                                <Badge 
                                  key={badge.key}
                                  variant={badge.variant}
                                  className={cn("capitalize rounded-full px-3 py-1 text-xs font-semibold shrink-0", badge.className)}
                                >
                                  {badge.label}
                                </Badge>
                              ))
                            ) : (
                              // Fallback for old data
                              <Badge 
                                variant="outline" 
                                className={cn(
                                  "capitalize rounded-full px-3 py-1 text-xs font-semibold shrink-0",
                                  isPast(getEffectiveDueDate(item as any) ?? new Date(item.dueDate as any)) && item.status === 'pending' ? 'bg-red-100 text-red-800' :
                                  isFuture(getEffectiveDueDate(item as any) ?? new Date(item.dueDate as any)) ? 'bg-blue-100 text-blue-800' :
                                  'bg-yellow-100 text-yellow-800'
                                )}
                              >
                                {isPast(getEffectiveDueDate(item as any) ?? new Date(item.dueDate as any)) && item.status === 'pending' ? 'Overdue' :
                                 isFuture(getEffectiveDueDate(item as any) ?? new Date(item.dueDate as any)) ? 'Upcoming' : 'Due Soon'}
                              </Badge>
                            )}
                            
                            {/* Kebab menu */}
                            <TaskActionMenu
                              entityType="task_action_item"
                              entityId={item.id}
                              entityTitle={item.title}
                              status={item.status}
                              variant="icon"
                              isRecurring={Boolean(item.isRecurring) || Boolean(item.recurrenceData)}
                              recurrenceData={item.recurrenceData as any}
                              parentId={taskActionId}
                              onSuccess={() => {
                                // Refresh the list after delete/complete
                                // Query invalidation is handled by TaskActionMenu
                              }}
                              onEdit={() => {
                                setEditingItemId(item.id);
                                setEditDialogOpen(true);
                              }}
                            />
                          </div>
                        </div>

                        {/* Date row */}
                        <div className="flex items-center text-muted-foreground gap-1.5 text-sm">
                          <Calendar className="w-4 h-4" />
                          <span>{format(getEffectiveDueDate(item as any) ?? new Date(item.dueDate as any), "MMM d, yyyy")}</span>
                        </div>

                        {/* Description */}
                        {item.description && (
                          <p className="text-sm text-muted-foreground leading-relaxed">
                            {item.description}
                          </p>
                        )}

                        {/* Recurrence info */}
                        <div className="pt-3 border-t border-border w-full min-w-0">
                          <ReminderDisplay
                            className="w-full min-w-0"
                            entityType="task_action_item"
                            entityId={item.id}
                            isRecurring={Boolean(item.isRecurring) || Boolean(item.recurrenceData)}
                            recurrenceData={item.recurrenceData as any}
                            dueDate={item.dueDate as any}
                            compactOccurrences
                            variant="embedded"
                          />
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      </DialogContent>

      {/* Create Dialog */}
      <VehicleItemCreateDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        vehicleId={taskActionId}
        vehicleName={taskActionTitle}
        entityKind="task_action"
        onSuccess={() => setCreateDialogOpen(false)}
      />

      {/* Edit Dialog */}
      {editingItem && (
        <VehicleItemCreateDialog
          mode="edit"
          editMetadataOnly={true}
          open={editDialogOpen}
          onOpenChange={setEditDialogOpen}
          vehicleId={taskActionId}
          vehicleName={taskActionTitle}
          vehicleItemId={editingItem.id}
          entityKind="task_action"
          initialData={{
            title: editingItem.title,
            dueDate: typeof editingItem.dueDate === 'string' ? editingItem.dueDate.split('T')[0] : new Date(editingItem.dueDate).toISOString().split('T')[0],
            description: editingItem.description || '',
            reminderDays: 7,
            reminderOffsetValue: 7,
            reminderOffsetUnit: 'days' as any,
            reminderTimes: ['09:00'],
            notificationChannels: ['email'],
            emailRecipients: (editingItem as any).emailRecipients || [],
            isRecurring: Boolean(editingItem.isRecurring),
            recurrenceData: (editingItem.recurrenceData || null) as any,
            customFields: (editingItem as any).customFields || {},
          } as any}
          onSuccess={() => {
            setEditDialogOpen(false);
            setEditingItemId(null);
          }}
        />
      )}
    </Dialog>
  );
}

