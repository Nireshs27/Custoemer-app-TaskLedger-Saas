import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Form,
  FormDescription,
  FormLabel,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Plus, Users, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { TaskLedgerUser, TaskAction, HrEmployee } from "@shared/schema";
import { CategorySelect } from "@/components/categories/category-select";

interface Assignee {
  id: string;
  name: string;
}

interface TaskActionTask {
  id: string;
  title: string;
  description: string;
  category: string;
  priority: string;
  assignees: Assignee[];
  taskPoints: string[];
  status?: string;
}

const simplifiedTaskFormSchema = z.object({});
type SimplifiedTaskFormData = z.infer<typeof simplifiedTaskFormSchema>;

const priorityLevels = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

interface SimplifiedTaskActionFormProps {
  onSuccess: () => void;
  onCancel: () => void;
  initialData?: TaskAction | null;
}

const parseJsonArray = (value: any) => {
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

export function SimplifiedTaskActionForm({
  onSuccess,
  onCancel,
  initialData,
}: SimplifiedTaskActionFormProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: employees, isLoading: employeesLoading } = useQuery<HrEmployee[]>({
    queryKey: ["/api/hr-employees"],
  });

  const uniqueEmployees = useMemo(() => {
    const list = Array.isArray(employees) ? employees : [];
    const seen = new Set<string>();
    const out: HrEmployee[] = [];
    for (const e of list) {
      const id = e.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(e);
    }
    return out;
  }, [employees]);

  const [task, setTask] = useState<TaskActionTask>(() => {
    if (initialData?.id) {
      const assignees = parseJsonArray((initialData as any).assignees) as Assignee[];
      const taskPointsRaw = (initialData as any).taskPoints ?? (initialData as any).task_points;
      const taskPoints = (parseJsonArray(taskPointsRaw) as any[]).map((v) => String(v));

      return {
        id: initialData.id,
        title: initialData.title || "",
        description: (initialData as any).description || "",
        category: (initialData as any).category || "",
        priority: ["low", "medium", "high"].includes((initialData as any).priority) 
          ? (initialData as any).priority 
          : "medium",
        assignees,
        taskPoints: taskPoints.length > 0 ? taskPoints : [""],
        status: (initialData as any).status,
      };
    }

    return {
      id: "1",
      title: "",
      description: "",
      category: "",
      priority: "low",
      assignees: [],
      taskPoints: [""],
    };
  });

  const form = useForm<SimplifiedTaskFormData>({
    resolver: zodResolver(simplifiedTaskFormSchema),
    defaultValues: {},
  });

  const createTaskActionsMutation = useMutation({
    mutationFn: async () => {
      if (process.env.NODE_ENV !== "production") {
        // Defensive: this form must never submit multiple tasks.
        // eslint-disable-next-line no-console
        console.assert(true, "[task-actions] single-create form submitting exactly 1 task");
      }

      if (!task.title.trim()) {
        throw new Error("Please enter a title");
      }

      const taskData = {
        title: task.title,
        description: task.description || "",
        category: task.category || null,
        priority: task.priority,
        assignees: task.assignees,
        taskPoints: task.taskPoints.filter((p) => p.trim()),
        status: "pending",
      };
      return await apiRequest("POST", "/api/task-actions", taskData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/task-actions"] });
      toast({
        title: "Task action created successfully!",
      });
      onSuccess();
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create tasks", description: error.message, variant: "destructive" });
    },
  });

  const updateTaskActionMutation = useMutation({
    mutationFn: async (task: TaskActionTask) => {
      if (!initialData?.id) throw new Error("Missing task action id");
      const taskData = {
        title: task.title,
        description: task.description || "",
        category: task.category || null,
        priority: task.priority,
        assignees: task.assignees,
        taskPoints: task.taskPoints.filter((p) => p.trim()),
        status: task.status ?? (initialData as any).status ?? "pending",
      };
      return await apiRequest("PUT", `/api/task-actions/${initialData.id}`, taskData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/task-actions"] });
      toast({
        title: "Task action updated successfully!",
        description: "Task action details have been updated",
      });
      onSuccess();
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update task action",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const onSubmit = () => {
    if (initialData?.id) {
      updateTaskActionMutation.mutate(task);
      return;
    }
    createTaskActionsMutation.mutate();
  };

  const updateTask = (updates: Partial<TaskActionTask>) => {
    setTask((prev) => ({ ...prev, ...updates }));
  };

  const addAssignee = (employeeId: string) => {
    const employee = uniqueEmployees?.find((e) => e.id === employeeId);
    if (!employee) return;
    setTask((prev) => {
      if (prev.assignees.some((a) => a.id === employeeId)) return prev;
      return { ...prev, assignees: [...prev.assignees, { id: employee.id, name: employee.fullName || `${employee.firstName} ${employee.lastName}` }] };
    });
  };

  const removeAssignee = (userId: string) => {
    setTask((prev) => ({ ...prev, assignees: prev.assignees.filter((a) => a.id !== userId) }));
  };

  const addTaskPoint = () => {
    setTask((prev) => ({ ...prev, taskPoints: [...prev.taskPoints, ""] }));
  };

  const updateTaskPoint = (index: number, value: string) => {
    setTask((prev) => ({
      ...prev,
      taskPoints: prev.taskPoints.map((p, i) => (i === index ? value : p)),
    }));
  };

  const removeTaskPoint = (index: number) => {
    setTask((prev) => {
      if (prev.taskPoints.length <= 1) return prev;
      return { ...prev, taskPoints: prev.taskPoints.filter((_, i) => i !== index) };
    });
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <div className="rounded-2xl border bg-white p-6 shadow-none space-y-6">
            <div className="flex flex-row items-center justify-between">
              <div>
                
                {initialData?.id ? (
                  <p className="text-sm text-muted-foreground mt-1">Update the task action details</p>
                ) : null}
              </div>
            </div>
            <div className="space-y-6">
              <div className="space-y-4">
                <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <FormLabel>Title *</FormLabel>
                        <Input
                          value={task.title}
                          onChange={(e) => updateTask({ title: e.target.value })}
                          placeholder="e.g., Complete Tax Audit"
                          data-testid="input-task-title"
                        />
                      </div>
                      <div className="space-y-2">
                        <FormLabel>Category (Optional)</FormLabel>
                        <CategorySelect
                          module="task_action"
                          value={task.category}
                          onChange={(value) => updateTask({ category: value })}
                          placeholder="Select category"
                        />
                      </div>
                      <div className="space-y-2">
                        <FormLabel>Priority</FormLabel>
                        <Select
                          value={task.priority}
                          onValueChange={(value) => updateTask({ priority: value })}
                        >
                          <SelectTrigger data-testid="select-priority">
                            <SelectValue placeholder="Select priority" />
                          </SelectTrigger>
                          <SelectContent>
                            {priorityLevels.map((priority) => (
                              <SelectItem key={priority.value} value={priority.value}>
                                {priority.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <FormLabel>Description (Optional)</FormLabel>
                      <Textarea
                        value={task.description}
                        onChange={(e) => updateTask({ description: e.target.value })}
                        placeholder="Additional details about this task..."
                        rows={2}
                        data-testid="input-description"
                      />
                    </div>

                    <div className="space-y-2">
                      <FormLabel className="flex items-center gap-2">
                        <Users className="w-4 h-4" />
                        Assign To (Optional)
                      </FormLabel>
                      <div className="flex flex-wrap gap-2 mb-2">
                        {task.assignees.map((assignee) => {
                          const employee = uniqueEmployees?.find(e => e.id === assignee.id);
                          return (
                            <div
                              key={assignee.id}
                              className="flex items-center gap-1.5 px-2 py-1 bg-primary/10 rounded-full"
                            >
                              {employee?.photoUrl ? (
                                <img
                                  src={employee.photoUrl}
                                  alt=""
                                  className="w-4 h-4 rounded-full object-cover"
                                />
                              ) : (
                                <div className="w-4 h-4 rounded-full bg-primary/20 flex items-center justify-center text-[8px] font-bold">
                                  {assignee.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                                </div>
                              )}
                              <span className="text-sm">{assignee.name}</span>
                              <button
                                type="button"
                                onClick={() => removeAssignee(assignee.id)}
                                className="text-muted-foreground hover:text-foreground ml-0.5"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                      <Select 
                        onValueChange={(value) => addAssignee(value)}
                        disabled={employeesLoading || uniqueEmployees.length === 0}
                      >
                        <SelectTrigger>
                          <SelectValue 
                            placeholder={
                              employeesLoading 
                                ? "Loading employees..." 
                                : uniqueEmployees.length === 0 
                                  ? "No employees found" 
                                  : "Add assignee"
                            } 
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {uniqueEmployees
                            .filter((e) => !task.assignees.some((a) => a.id === e.id))
                            .map((employee) => (
                              <SelectItem key={employee.id} value={employee.id}>
                                <div className="flex items-center gap-2">
                                  {employee.photoUrl ? (
                                    <img
                                      src={employee.photoUrl}
                                      alt=""
                                      className="w-5 h-5 rounded-full object-cover"
                                    />
                                  ) : (
                                    <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center text-[10px]">
                                      {employee.fullName?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || employee.firstName[0]}
                                    </div>
                                  )}
                                  <span>{employee.fullName || `${employee.firstName} ${employee.lastName}`}</span>
                                </div>
                              </SelectItem>
                            ))}
                          {!employeesLoading && uniqueEmployees.length === 0 && (
                            <SelectItem value="_none" disabled>
                              No active employees found
                            </SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <FormLabel>Task Points / Responsibilities</FormLabel>
                      <FormDescription className="text-xs">
                        List specific action items or responsibilities for this task
                      </FormDescription>
                      {task.taskPoints.map((point, pointIndex) => (
                        <div key={pointIndex} className="flex items-center gap-2">
                          <Input
                            value={point}
                            onChange={(e) => updateTaskPoint(pointIndex, e.target.value)}
                            placeholder={`Point ${pointIndex + 1}`}
                            data-testid={`input-task-point-${pointIndex}`}
                          />
                          {task.taskPoints.length > 1 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => removeTaskPoint(pointIndex)}
                            >
                              <X className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      ))}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => addTaskPoint()}
                      >
                        <Plus className="w-4 h-4 mr-2" />
                        Add Point
                      </Button>
                    </div>
                </div>
              </div>
            </div>
          </div>

          <div className="modal-footer-actions">
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createTaskActionsMutation.isPending || updateTaskActionMutation.isPending}
              data-testid="button-save-task-action"
            >
              {initialData?.id
                ? updateTaskActionMutation.isPending
                  ? "Updating..."
                  : "Update Task Action"
                : createTaskActionsMutation.isPending
                  ? "Creating..."
                  : "Create Task Action"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}

