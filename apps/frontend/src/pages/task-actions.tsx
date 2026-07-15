import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Plus,
  Users,
  ListChecks,
  Calendar,
  Search,
  LayoutGrid,
  List,
  MoreVertical,
  Edit,
  Trash2,
  Eye,
} from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import type { TaskAction, TaskActionItem } from "@shared/schema";
import { SimplifiedTaskActionForm } from "@/components/forms/simplified-task-action-form";
import { TaskActionItemsDialog } from "@/components/task-action-items-dialog";
import { buildSummary, getSummaryStatus, type SummaryResult } from "@/lib/entity-summary";
import { getSummaryBadges } from "@/lib/summary-badges";
import { getEffectiveDueDate } from "@/lib/effective-due-date";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import {
  optimisticDeleteTaskAction,
  rollbackTaskActionQueries,
  invalidateTaskActionQueries,
} from "@/lib/optimistic-updates";
import { ConfirmDeleteByNameDialog } from "@/components/common/ConfirmDeleteByNameDialog";
import { useCategories } from "@/hooks/use-categories";
import { EntityOverviewModal } from "@/components/overview/EntityOverviewModal";
import { EntityCardMenu } from "@/components/entity/entity-card-menu";
import { guardCardClick } from "@/lib/ui-event-guards";

export default function TaskActions() {
  const { toast } = useToast();
  const [viewMode, setViewMode] = useState<'card' | 'list'>('card');
  const [searchQuery, setSearchQuery] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [showForm, setShowForm] = useState(false);
  const [selectedTask, setSelectedTask] = useState<TaskActionWithSummary | null>(null);
  const [taskActionToDelete, setTaskActionToDelete] = useState<{ id: string; name: string } | null>(
    null
  );
  const [taskActionToEdit, setTaskActionToEdit] = useState<TaskAction | null>(null);
  const [overviewTask, setOverviewTask] = useState<TaskActionWithSummary | null>(null);

  const priorityOptions = [
    { value: "all", label: "All Priority" },
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
  ];

  type TaskActionNormalized = TaskAction & {
    assignees: Array<{ id: string; name: string }>;
    createdAt?: string | Date;
  };
  type TaskActionWithSummary = TaskActionNormalized & { summary: SummaryResult };

  const { data: taskActionsRaw = [], isLoading } = useQuery<TaskAction[]>({
    queryKey: ["/api/task-actions"],
  });
  const { data: taskActionItems = [] } = useQuery<TaskActionItem[]>({
    queryKey: ["/api/task-action-items"],
  });

  const { data: employees = [] } = useQuery<any[]>({
    queryKey: ["/api/hr-employees"],
  });

  const employeeMap = useMemo(() => {
    const map = new Map<string, any>();
    employees.forEach(emp => map.set(emp.id, emp));
    return map;
  }, [employees]);

  const { data: categories = [] } = useCategories("task_action");

  const categoryMap = useMemo(() => {
    const map = new Map();
    (categories ?? []).forEach((cat) => {
      map.set(cat.id, cat.name);
    });
    return map;
  }, [categories]);

  const getCategoryName = (categoryId: any): string | null => {
    if (!categoryId) return null;
    return categoryMap.get(categoryId) || null;
  };

  // Delete mutation with optimistic updates (Lightning Fast!)
  const deleteTaskActionMutation = useMutation({
    mutationFn: async (taskActionId: string) => {
      const response = await fetch(`/api/task-actions/${taskActionId}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || "Failed to delete task action");
      }

      return null;
    },
    onMutate: async (taskActionId) => {
      const context = await optimisticDeleteTaskAction(queryClient, taskActionId);
      setTaskActionToDelete(null);
      setSelectedTask(null);
      return context;
    },
    onSuccess: () => {
      toast({
        title: "Task Action Deleted",
        description: "Task action and all its child tasks have been removed successfully",
      });
    },
    onError: (error: Error, _taskActionId, context) => {
      if (context?.previousData) {
        rollbackTaskActionQueries(queryClient, context.previousData);
      }
      toast({
        title: "Error",
        description: error.message || "Failed to delete task action",
        variant: "destructive",
      });
    },
    onSettled: () => {
      invalidateTaskActionQueries(queryClient);
    },
  });

  const parseAssignees = (value: any) => {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  };

  const parseTaskPoints = (value: any) => {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  };

  const normalizedActions = useMemo<TaskActionNormalized[]>(() => {
    return taskActionsRaw.map((a) => ({
      ...a,
      assignees: parseAssignees((a as any).assignees),
      taskPoints: parseTaskPoints((a as any).taskPoints ?? (a as any).task_points),
      // ⚠️ REMOVED: dueDate - Task Actions parent doesn't have due dates
      // Use summary.nextDueItem.dueDate from task_action_items instead
      createdAt: (a as any).createdAt || (a as any).created_at,
    }));
  }, [taskActionsRaw]);

  const itemsByTaskAction = useMemo(() => {
    const map = new Map<string, TaskActionItem[]>();
    taskActionItems.forEach((item) => {
      if (!map.has(item.taskActionId)) {
        map.set(item.taskActionId, []);
      }
      map.get(item.taskActionId)!.push(item);
    });
    return map;
  }, [taskActionItems]);

  const actionsWithSummary: TaskActionWithSummary[] = useMemo(() => {
    return normalizedActions.map((action: any) => {
      // ✅ Use server-provided occurrenceSummary (single source of truth)
      const occSummary = action.occurrenceSummary || {
        itemsCount: 0,
        pendingCount: 0,
        overdueCount: 0,
        dueTodayCount: 0,
        upcomingCount: 0,
        nextDueOccurrence: null,
      };
      
      const summary: SummaryResult = {
        itemsCount: occSummary.itemsCount,
        nextDueItem: occSummary.nextDueOccurrence ? {
          title: occSummary.nextDueOccurrence.title,
          dueDate: occSummary.nextDueOccurrence.dueDateLocalYmd,
          notes: occSummary.nextDueOccurrence.notes,
        } : null,
        overdueCount: occSummary.overdueCount,
        dueTodayCount: occSummary.dueTodayCount,
        upcomingCount: occSummary.upcomingCount,
        pendingCount: occSummary.pendingCount,
      };
      
      return {
        ...action,
        summary,
      };
    });
  }, [normalizedActions]);

  const filteredActions = useMemo(() => {
    const query = searchQuery.toLowerCase();
    
    const filtered = actionsWithSummary.filter((action) => {
      const assigneeNames = (action.assignees || []).map((a) => a.name?.toLowerCase?.() || "").join(" ");
      const matchesSearch =
        action.title.toLowerCase().includes(query) ||
        (action.description || "").toLowerCase().includes(query) ||
        (action.category || "").toLowerCase().includes(query) ||
        assigneeNames.includes(query);

      const matchesPriority = priorityFilter === "all" ? true : action.priority === priorityFilter;
      const matchesCategory = categoryFilter === "all" ? true : action.category === categoryFilter;
      return matchesSearch && matchesPriority && matchesCategory;
    });

    // Preserve server ordering (created_at DESC - newest first)
    return filtered;
  }, [actionsWithSummary, searchQuery, priorityFilter, categoryFilter]);

  const getSummaryBadgeVariant = (priority: string) => {
    switch (priority) {
      case "high":
        return "destructive";
      case "medium":
        return "secondary";
      default:
        return "outline";
    }
  };

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

  const TaskCard = ({ task }: { task: TaskActionWithSummary }) => {
    const summary = task.summary ?? { itemsCount: 0, overdueCount: 0, nextDueItem: null };
    const summaryStatus = getSummaryStatus(summary);
    const SummaryStatusIcon = summaryStatus.icon;
    const priorityStyle = getPriorityBadgeStyle(task.priority);

    return (
      <Card
        className="hover:-translate-y-3 transition-all duration-300 cursor-pointer"
        data-testid={`task-card-${task.id}`}
        onClick={(e) => {
          if (guardCardClick(e)) return;
          setSelectedTask(task);
        }}
        role="button"
      >
        <CardHeader className="p-5 sm:p-6 pb-3">
          <div className="flex items-start justify-between">
            <div className="space-y-1.5 flex-1">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className={cn("px-2 py-0 text-[10px] font-semibold uppercase tracking-wider", priorityStyle.className)}>
                  {priorityStyle.label}
                </Badge>
              </div>
              <CardTitle className="text-lg line-clamp-2">{task.title}</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex flex-wrap items-center justify-end gap-1.5">
                {getSummaryBadges({
                  overdueCount: summary.overdueCount,
                  dueTodayCount: summary.dueTodayCount,
                  upcomingCount: summary.upcomingCount,
                }).map((badge) => (
                  <Badge 
                    key={badge.key}
                    variant={badge.variant}
                    className={cn("px-2 py-0.5 text-xs font-medium", badge.className)}
                  >
                    {badge.label}
                  </Badge>
                ))}
              </div>
              <EntityCardMenu
                entityType="task_action"
                entityId={task.id}
                entityLabel={task.title}
                onOverview={() => setOverviewTask(task)}
                onEdit={() => {
                  setSelectedTask(null);
                  const raw = taskActionsRaw.find((t) => t.id === task.id);
                  if (raw) setTaskActionToEdit(raw);
                }}
                onDelete={() => {
                  setSelectedTask(null);
                  setTaskActionToDelete({ id: task.id, name: task.title });
                }}
                dataTestId={`task-action-menu-${task.id}`}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-5 sm:p-6 pt-0 space-y-4">
          {task.description && (
            <p className="text-sm text-muted-foreground line-clamp-2" data-testid={`description-${task.id}`}>
              {task.description}
            </p>
          )}
          
          <div className="grid grid-cols-1 gap-3 text-sm">
            <div className="flex items-center text-muted-foreground">
              <SummaryStatusIcon className="w-4 h-4 mr-2" />
              {summary.itemsCount} items
            </div>

            {getCategoryName(task.category) && (
              <div className="flex items-center text-muted-foreground">
                <ListChecks className="w-4 h-4 mr-2" />
                <span className="text-muted-foreground">Category</span>
                <span className="ml-1 text-foreground">{getCategoryName(task.category)}</span>
              </div>
            )}

            {task.createdAt && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Created</span>
                <span className="flex items-center text-muted-foreground">
                  <Calendar className="w-4 h-4 mr-2" />
                  {format(new Date(task.createdAt), "MMM d, yyyy")}
                </span>
              </div>
            )}

            {task.assignees && task.assignees.length > 0 && (
              <div className="flex items-center space-x-2">
                <Users className="w-4 h-4 text-muted-foreground" />
                <span className="text-muted-foreground">Assignees:</span>
                <div className="flex -space-x-2 overflow-hidden">
                  {task.assignees.map((a) => {
                    const employee = employeeMap.get(a.id);
                    return (
                      <div
                        key={a.id}
                        className="inline-block h-6 w-6 rounded-full ring-2 ring-white bg-primary/10 flex items-center justify-center overflow-hidden"
                        title={a.name}
                      >
                        {employee?.photoUrl ? (
                          <img
                            src={employee.photoUrl}
                            alt={a.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <span className="text-[10px] font-medium">
                            {a.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
                <span className="font-medium text-xs ml-1">
                  {task.assignees.length === 1 
                    ? task.assignees[0].name 
                    : `${task.assignees.length} assignees`}
                </span>
              </div>
            )}

            {task.taskPoints && task.taskPoints.length > 0 && (
              <div className="flex items-start space-x-2">
                <ListChecks className="w-4 h-4 text-muted-foreground mt-0.5" />
                <div className="flex-1">
                  <p className="text-muted-foreground">{task.taskPoints.length} task point{task.taskPoints.length > 1 ? 's' : ''}</p>
                </div>
              </div>
            )}

            {summary.nextDueItem && (
              <div className="mt-2 pt-2 border-t border-muted text-xs text-muted-foreground bg-muted/30 rounded p-2">
                {(() => {
                  const nextTitle =
                    summary.nextDueItem.title || summary.nextDueItem.notes || "—";
                  const eff = getEffectiveDueDate(summary.nextDueItem as any);
                  const nextDate = eff ? format(eff, "MMM d") : null;

                  return (
                    <>
                      Next: {nextTitle}
                      {nextDate ? ` (${nextDate})` : ""}
                    </>
                  );
                })()}
              </div>
            )}
          </div>

        </CardContent>
      </Card>
    );
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-6 max-w-screen-2xl space-y-6">
        <Card className="text-center py-12">
          <CardContent>
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-muted-foreground">Loading task actions...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-6 max-w-screen-2xl space-y-6">
      <Card className="rounded-xl px-2">
        <CardContent className="p-4 sm:p-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-2xl font-bold">Task Actions</h1>
              <p className="text-muted-foreground">Manage tasks with assignees and responsibilities</p>
            </div>
            <div className="flex items-center space-x-4">
              <div className="flex bg-muted rounded-lg p-1">
                <Button
                  variant={viewMode === 'card' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setViewMode('card')}
                  className="px-3"
                  data-testid="view-card"
                >
                  <LayoutGrid className="w-4 h-4" />
                </Button>
                <Button
                  variant={viewMode === 'list' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setViewMode('list')}
                  className="px-3"
                  data-testid="view-list"
                >
                  <List className="w-4 h-4" />
                </Button>
              </div>
              <Button data-testid="button-add-task" onClick={() => setShowForm(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Add Task Actions
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardContent className="p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="relative flex-1 max-w-md w-full">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search task actions..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
                data-testid="input-search-tasks"
              />
            </div>
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="w-full sm:w-48" data-testid="select-priority-filter">
                <SelectValue placeholder="All Priority" />
              </SelectTrigger>
              <SelectContent>
                {priorityOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-full sm:w-48" data-testid="select-category-filter">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {(categories ?? []).map((cat) => (
                  <SelectItem key={cat.id} value={cat.id}>
                    {cat.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4">
        {viewMode === 'card' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredActions.map((task) => (
              <TaskCard key={task.id} task={task} />
            ))}
          </div>
        ) : (
          <Card className="rounded-xl overflow-hidden">
            <CardContent className="p-0">
              <Table className="min-w-[640px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="px-4 py-3">Status</TableHead>
                    <TableHead className="px-4 py-3">Task</TableHead>
                    <TableHead className="px-4 py-3">Assignees</TableHead>
                    <TableHead className="px-4 py-3">Points</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y">
                  {filteredActions.map((task) => {
                    const summary = task.summary;
                    const summaryStatus = getSummaryStatus(summary);
                    const SummaryStatusIcon = summaryStatus.icon;

                    return (
                      <TableRow
                        key={task.id}
                        className="px-4 py-3 cursor-pointer"
                        data-testid={`task-row-${task.id}`}
                        onClick={(e) => {
                          if (guardCardClick(e)) return;
                          setSelectedTask(task);
                        }}
                      >
                        <TableCell className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {getSummaryBadges({
                              overdueCount: summary.overdueCount,
                              dueTodayCount: summary.dueTodayCount,
                              upcomingCount: summary.upcomingCount,
                            }).map((badge) => (
                              <Badge 
                                key={badge.key}
                                variant={badge.variant}
                                className={cn("px-2 py-0.5 text-xs font-medium", badge.className)}
                              >
                                {badge.label}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="px-4 py-3">
                          <div>
                            <p className="font-medium line-clamp-1">{task.title}</p>
                            {task.description && (
                              <p className="text-sm text-muted-foreground line-clamp-1">{task.description}</p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="px-4 py-3">
                          {task.assignees && task.assignees.length > 0 ? (
                            <span className="text-sm">{task.assignees.map(a => a.name).join(', ')}</span>
                          ) : (
                            <span className="text-sm text-muted-foreground">None</span>
                          )}
                        </TableCell>
                        <TableCell className="px-4 py-3 text-sm">
                          {task.taskPoints?.length || 0}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {filteredActions.length === 0 && (
          <Card className="text-center py-12">
            <CardContent>
              <ListChecks className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-lg font-medium mb-2">No task actions found</h3>
              <p className="text-muted-foreground mb-4">
                {searchQuery ? "Try adjusting your search terms." : "Start by adding your first task action."}
              </p>
              <Button data-testid="button-add-first-task" onClick={() => setShowForm(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Add Task Action
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold mb-3">Add Task Actions</DialogTitle>
            <div className="text-sm text-muted-foreground">
              Create actionable tasks, assign responsibilities, and track progress with clear task points.
            </div>
            <DialogDescription className="sr-only">
              Form to create or edit this item.
            </DialogDescription>
          </DialogHeader>
          <SimplifiedTaskActionForm 
            onSuccess={() => setShowForm(false)} 
            onCancel={() => setShowForm(false)} 
          />
        </DialogContent>
      </Dialog>

      <TaskActionItemsDialog
        open={!!selectedTask}
        onOpenChange={() => setSelectedTask(null)}
        taskActionId={selectedTask?.id ?? ""}
        taskActionTitle={selectedTask?.title ?? ""}
        priority={selectedTask?.priority}
        createdAt={selectedTask?.createdAt}
      />

      {/* Delete Confirmation Dialog - Type to Confirm */}
      <ConfirmDeleteByNameDialog
        open={!!taskActionToDelete}
        onClose={() => setTaskActionToDelete(null)}
        entityLabel="Task Action"
        entityName={taskActionToDelete?.name ?? ""}
        onConfirm={async () => {
          if (!taskActionToDelete) return;
          await deleteTaskActionMutation.mutateAsync(taskActionToDelete.id);
        }}
      />

      {/* Edit Task Action Dialog */}
      {taskActionToEdit && (
        <Dialog
          open={!!taskActionToEdit}
          onOpenChange={(open) => !open && setTaskActionToEdit(null)}
        >
          <DialogContent className="max-h-[90vh] overflow-y-auto" data-testid="modal-edit-task-action">
            <DialogHeader>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={cn("px-2 py-0 text-[10px] font-semibold uppercase tracking-wider", getPriorityBadgeStyle(taskActionToEdit.priority).className)}>
                    {getPriorityBadgeStyle(taskActionToEdit.priority).label} Priority
                  </Badge>
                </div>
                <DialogTitle className="flex items-center space-x-2">
                  <Edit className="w-5 h-5" />
                  <span>Edit Task Action</span>
                </DialogTitle>
              </div>
              {getCategoryName(taskActionToEdit.category) && (
                <p className="text-sm text-muted-foreground">
                  Category: <span className="font-medium">{getCategoryName(taskActionToEdit.category)}</span>
                </p>
              )}
              {taskActionToEdit?.createdAt && (
                <p className="text-sm text-muted-foreground">
                  Created: {format(new Date(taskActionToEdit.createdAt as any), "MMM d, yyyy")}
                </p>
              )}
              <DialogDescription className="sr-only">
                Form to create or edit this item.
              </DialogDescription>
            </DialogHeader>
            <SimplifiedTaskActionForm
              initialData={taskActionToEdit}
              onSuccess={() => setTaskActionToEdit(null)}
              onCancel={() => setTaskActionToEdit(null)}
            />
          </DialogContent>
        </Dialog>
      )}

      {/* Overview Modal */}
      {overviewTask && (
        <EntityOverviewModal
          open={!!overviewTask}
          onOpenChange={(open) => !open && setOverviewTask(null)}
          entityType="task_action"
          entityId={overviewTask.id}
          entityLabel={overviewTask.title}
          entitySummary={{
            title: overviewTask.title,
            priority: overviewTask.priority,
            category: getCategoryName(overviewTask.category) || "Uncategorized",
            description: overviewTask.description || "No description",
            assignees: overviewTask.assignees || [],
            createdAt: overviewTask.createdAt ? format(new Date(overviewTask.createdAt), "MMM d, yyyy") : "Unknown",
            itemsCount: overviewTask.summary.itemsCount || 0,
            overdueCount: overviewTask.summary.overdueCount,
            dueTodayCount: overviewTask.summary.dueTodayCount,
            upcomingCount: overviewTask.summary.upcomingCount,
          }}
        />
      )}
    </div>
  );
}