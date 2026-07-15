import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar, AlertTriangle, CheckCircle, Clock, Repeat, Plus, X } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { queryClient } from "@/lib/queryClient";
import type { TaxLegalItem } from "@shared/schema";
import { getEffectiveDueDate } from "@/lib/effective-due-date";
import { toISTYmd, classifyYmdStatus } from "@/lib/ymd-status";
import { ReminderDisplay } from "@/components/reminder-display";
import { VehicleItemCreateDialog } from "@/components/vehicle-item-create-dialog";
import { TaskActionMenu } from "@/components/task-action-menu";
import { getSummaryBadges } from "@/lib/summary-badges";

interface TaxLegalItemsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  complianceId: string;
  complianceTitle: string;
  complianceCategory?: string | null;
  createdAt?: string | Date;
}

export function TaxLegalItemsDialog({
  open,
  onOpenChange,
  complianceId,
  complianceTitle,
  createdAt,
}: TaxLegalItemsDialogProps) {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);

  const itemsQueryKey = `/api/tax-legal-compliances/${complianceId}/items`;

  const { data: items = [], isLoading } = useQuery<TaxLegalItem[]>({
    queryKey: [itemsQueryKey],
    enabled: open,
  });

  // ✅ Always get fresh editing item from cache (prevents stale data)
  const editingItem = editingItemId ? items.find(item => item.id === editingItemId) : null;

  const getStatusInfo = (item: any) => {
    // PRIMARY: Use occurrenceSummary if available
    if (item.occurrenceSummary) {
      const s = item.occurrenceSummary;
      const overdue = s.overdueCount ?? 0;
      const today = s.dueTodayCount ?? 0;
      const upcoming = s.upcomingCount ?? 0;
      
      if ((item.status || "").toLowerCase() === "completed") {
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
    if ((item.status || "").toLowerCase() === "completed") {
      return {
        icon: CheckCircle,
        color: "text-green-600 bg-green-50 dark:bg-green-950",
      };
    }

    const eff = getEffectiveDueDate(item as any);
    const dueDate = eff ?? new Date((item as any).dueDate);
    const dueYmd = toISTYmd(dueDate);
    const todayYmd = toISTYmd(new Date());
    const status = classifyYmdStatus(dueYmd, todayYmd);

    if (status === "overdue") {
      return {
        icon: AlertTriangle,
        color: "text-red-600 bg-red-50 dark:bg-red-950",
      };
    }

    if (status === "today") {
      return {
        icon: Clock,
        color: "text-orange-600 bg-orange-50 dark:bg-orange-950",
      };
    }

    return {
      icon: Clock,
      color: "text-blue-600 bg-blue-50 dark:bg-blue-950",
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
              <DialogTitle className="text-xl sm:text-2xl font-semibold">Tasks for {complianceTitle}</DialogTitle>
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
                data-testid="tax-legal-add-task-button"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Task
              </Button>
            </div>
          </div>
          
          {/* Subtitle */}
          <DialogDescription className="text-sm text-muted-foreground pt-2">
            View and manage all tasks for this compliance
          </DialogDescription>
        </DialogHeader>

        {/* Scrollable task list */}
        <div className="flex-1 overflow-y-auto space-y-4 pr-2">
          {isLoading ? (
            <>
              {[...Array(3)].map((_, i) => (
                <Card key={i} className="rounded-2xl">
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between">
                      <div className="space-y-2 flex-1">
                        <Skeleton className="h-4 w-48" />
                        <Skeleton className="h-3 w-32" />
                      </div>
                      <Skeleton className="h-8 w-8 rounded-full" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </>
          ) : items.length === 0 ? (
            <Card className="rounded-2xl">
              <CardContent className="p-8 text-center text-muted-foreground">
                No tasks found for this compliance
              </CardContent>
            </Card>
          ) : (
            items.map((item: any) => {
              const statusInfo = getStatusInfo(item);
              const StatusIcon = statusInfo.icon;
              const eff = getEffectiveDueDate(item as any);
              const dueDateValue = eff ?? (item.dueDate ? new Date(item.dueDate) : null);

              return (
                <Card 
                  key={item.id} 
                  className="m-2 sm:m-4 p-4 sm:p-6 rounded-3xl bg-white border-0 shadow-occurrence hover:shadow-occurrence-hover transition-shadow duration-200"
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
                        {/* Title row with status */}
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <h4 className="font-semibold text-lg text-foreground leading-tight">{item.title}</h4>
                            {item.isRecurring && (
                              <Repeat className="w-4 h-4 text-purple-600" />
                            )}
                          </div>
                          <div className="flex flex-wrap items-center justify-end gap-1.5">
                            {(item.status || "").toLowerCase() === 'completed' ? (
                              <Badge 
                                variant="outline" 
                                className="capitalize rounded-full px-3 py-1 text-xs font-semibold shrink-0 bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300"
                              >
                                Completed
                              </Badge>
                            ) : item.occurrenceSummary ? (
                              getSummaryBadges({
                                overdueCount: item.occurrenceSummary.overdueCount,
                                dueTodayCount: item.occurrenceSummary.dueTodayCount,
                                upcomingCount: item.occurrenceSummary.upcomingCount,
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
                                  classifyYmdStatus(toISTYmd(dueDateValue ?? new Date()), toISTYmd(new Date())) === "overdue" ? 'bg-red-100 text-red-800' :
                                  classifyYmdStatus(toISTYmd(dueDateValue ?? new Date()), toISTYmd(new Date())) === "today" ? 'bg-orange-100 text-orange-800' :
                                  'bg-blue-100 text-blue-800'
                                )}
                              >
                                {classifyYmdStatus(toISTYmd(dueDateValue ?? new Date()), toISTYmd(new Date())) === "overdue" ? 'Overdue' :
                                 classifyYmdStatus(toISTYmd(dueDateValue ?? new Date()), toISTYmd(new Date())) === "today" ? 'Due Today' : 'Upcoming'}
                              </Badge>
                            )}
                          </div>
                        </div>

                        {/* Category and date row */}
                        <div className="flex flex-wrap items-center gap-3 text-sm">
                          <Badge 
                            variant="outline" 
                            className="capitalize rounded-full bg-white border-gray-300 text-gray-700 px-3 py-1"
                          >
                            {item.isRecurring ? "Recurring" : "One-time"}
                          </Badge>

                          {dueDateValue && (
                            <div className="flex items-center text-muted-foreground gap-1.5">
                              <Calendar className="w-4 h-4" />
                              <span>{format(dueDateValue, "MMM d, yyyy")}</span>
                            </div>
                          )}
                        </div>

                        {/* Description */}
                        {item.description && (
                          <p className="text-sm text-muted-foreground leading-relaxed">
                            {item.description}
                          </p>
                        )}

                        {/* Amount */}
                        {item.amount && (
                          <p className="text-sm font-medium text-foreground">
                            Amount: ₹{Number(item.amount).toLocaleString("en-IN")}
                          </p>
                        )}

                        {/* Recurrence info */}
                        <div className="pt-3 border-t border-border w-full min-w-0">
                          <ReminderDisplay
                            className="w-full min-w-0"
                            entityType="tax_legal_item"
                            entityId={item.id}
                            isRecurring={Boolean(item.isRecurring) || Boolean(item.recurrenceData)}
                            recurrenceData={item.recurrenceData as any}
                            dueDate={item.dueDate}
                            compactOccurrences
                            variant="embedded"
                          />
                        </div>
                      </div>

                      {/* Action menu */}
                      <div className="flex-shrink-0">
                        <TaskActionMenu
                          entityType="tax_legal_item"
                          entityId={item.id}
                          entityTitle={item.title}
                          status={item.status}
                          isRecurring={Boolean(item.isRecurring) || Boolean(item.recurrenceData)}
                          recurrenceData={item.recurrenceData}
                          variant="icon"
                          parentId={complianceId}
                          onEdit={() => {
                            setEditingItemId(item.id);
                            setEditDialogOpen(true);
                          }}
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>

        <VehicleItemCreateDialog
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
          vehicleId={complianceId}
          vehicleName={complianceTitle}
          entityKind="tax_legal"
          onSuccess={() => {
            setCreateDialogOpen(false);
            queryClient.invalidateQueries({ queryKey: [itemsQueryKey] });
          }}
        />

        {editingItem && (
          <VehicleItemCreateDialog
            mode="edit"
            editMetadataOnly={true}
            open={editDialogOpen}
            onOpenChange={setEditDialogOpen}
            vehicleId={complianceId}
            vehicleName={complianceTitle}
            vehicleItemId={editingItem.id}
            entityKind="tax_legal"
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
              queryClient.invalidateQueries({ queryKey: [itemsQueryKey] });
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}


