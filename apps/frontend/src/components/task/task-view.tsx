import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  CheckCircle, 
  Clock, 
  Calendar, 
  AlertTriangle,
  Filter,
  Tag,
  User
} from "lucide-react";
import { format, isToday, isTomorrow, isThisWeek } from "date-fns";
import { cn } from "@/lib/utils";

interface Task {
  id: string;
  occurrenceKey: string;
  title: string;
  description?: string | null;
  dueDate: string; // ISO string from API
  category: string;
  status: 'pending' | 'completed' | 'overdue';
  priority: 'low' | 'medium' | 'high';
  entityType: 'taxlegal' | 'vehicle' | 'asset' | 'action';
  entityId: string;
  entityName: string;
  tags?: string[];
}

interface TaskCounts {
  today: number;
  upcoming: number;
  overdue: number;
  completed: number;
}

export default function TaskView() {
  const [filterBy, setFilterBy] = useState("all");
  const [selectedTab, setSelectedTab] = useState("upcoming");
  const [selectedMonth, setSelectedMonth] = useState<string>("all");
  const [selectedYear, setSelectedYear] = useState<string>("all");

  // Get current year in IST
  const currentYear = useMemo(() => {
    const now = new Date();
    const istNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    return istNow.getFullYear();
  }, []);

  // Generate year options (currentYear-2 to currentYear+5)
  const yearOptions = useMemo(() => {
    const years: Array<{ value: string; label: string }> = [{ value: "all", label: "All Years" }];
    for (let i = currentYear - 2; i <= currentYear + 5; i++) {
      years.push({ value: String(i), label: String(i) });
    }
    return years;
  }, [currentYear]);

  // Build month param for API
  const monthParam = useMemo(() => {
    if (selectedMonth === "all") return "all";
    if (selectedYear === "all") return "all";
    return `${selectedYear}-${selectedMonth}`;
  }, [selectedMonth, selectedYear]);

  // Handler for month change with auto-set year logic
  const handleMonthChange = (value: string) => {
    setSelectedMonth(value);
    // Auto-set year to current if month is selected but year is "all"
    if (value !== "all" && selectedYear === "all") {
      setSelectedYear(String(currentYear));
    }
  };

  const { data: tasks = [], isLoading } = useQuery<Task[]>({
    queryKey: ["/api/tasks", selectedTab, filterBy, monthParam],
    queryFn: async () => {
      const params = new URLSearchParams({
        tab: selectedTab,
        kind: filterBy,
        sort: "dueDate",
        month: monthParam,
      });
      const response = await fetch(`/api/tasks?${params}`);
      if (!response.ok) throw new Error('Failed to fetch tasks');
      return response.json();
    },
  });

  const { data: taskCounts } = useQuery<TaskCounts>({
    queryKey: ["/api/tasks/counts", filterBy, monthParam],
    queryFn: async () => {
      const params = new URLSearchParams({
        kind: filterBy,
        month: monthParam,
      });
      const response = await fetch(`/api/tasks/counts?${params}`);
      if (!response.ok) throw new Error('Failed to fetch task counts');
      return response.json();
    },
  });

  // Server now handles filtering and sorting, so we just use tasks directly
  const filteredAndSortedTasks = tasks;

  const getTaskDateText = (dueDate: string) => {
    const date = new Date(dueDate);
    if (isToday(date)) return "Today";
    if (isTomorrow(date)) return "Tomorrow";
    if (isThisWeek(date)) return format(date, "EEEE");
    return format(date, "MMM d, yyyy");
  };

  const getTaskStatus = (task: Task) => {
    if (task.status === 'completed') return { icon: CheckCircle, color: 'text-green-600 bg-green-50', text: 'Completed' };
    // Use tab to determine status (server already filtered correctly)
    if (selectedTab === 'overdue') return { icon: AlertTriangle, color: 'text-red-600 bg-red-50', text: 'Overdue' };
    if (selectedTab === 'today') return { icon: Clock, color: 'text-orange-600 bg-orange-50', text: 'Due Today' };
    return { icon: Clock, color: 'text-blue-600 bg-blue-50', text: 'Upcoming' };
  };

  const getEntityIcon = (entityType: string) => {
    switch (entityType) {
      case 'taxlegal': return '📊';
      case 'vehicle': return '🚗';
      case 'asset': return '🏭';
      case 'action': return '📋';
      default: return '📋';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header with Filters */}
      <Card className="bg-white border-0 rounded-2xl">
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-end gap-3">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 w-full sm:w-auto">
              <Select value={filterBy} onValueChange={setFilterBy}>
                <SelectTrigger className="w-full sm:w-56 bg-white/80 border-0 shadow-sm" data-testid="filter-tasks">
                  <Filter className="w-4 h-4 mr-2" />
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="vehicle">Vehicles</SelectItem>
                  <SelectItem value="asset">Assets</SelectItem>
                  <SelectItem value="action">Task Actions</SelectItem>
                  <SelectItem value="taxlegal">Tax & Legal Compliances</SelectItem>
                </SelectContent>
              </Select>

              <Select value={selectedMonth} onValueChange={handleMonthChange}>
                <SelectTrigger className="w-full sm:w-36 bg-white/80 border-0 shadow-sm">
                  <Calendar className="w-4 h-4 mr-2" />
                  <SelectValue placeholder="Month" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Months</SelectItem>
                  <SelectItem value="01">January</SelectItem>
                  <SelectItem value="02">February</SelectItem>
                  <SelectItem value="03">March</SelectItem>
                  <SelectItem value="04">April</SelectItem>
                  <SelectItem value="05">May</SelectItem>
                  <SelectItem value="06">June</SelectItem>
                  <SelectItem value="07">July</SelectItem>
                  <SelectItem value="08">August</SelectItem>
                  <SelectItem value="09">September</SelectItem>
                  <SelectItem value="10">October</SelectItem>
                  <SelectItem value="11">November</SelectItem>
                  <SelectItem value="12">December</SelectItem>
                </SelectContent>
              </Select>

              <Select value={selectedYear} onValueChange={setSelectedYear}>
                <SelectTrigger className="w-full sm:w-32 bg-white/80 border-0 shadow-sm">
                  <SelectValue placeholder="Year" />
                </SelectTrigger>
                <SelectContent>
                  {yearOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Task Tabs */}
      <Tabs value={selectedTab} onValueChange={setSelectedTab} className="p-3 sm:p-4 space-y-4 bg-white rounded-2xl">
        <TabsList className="flex h-auto w-full flex-col gap-2 bg-muted/50 rounded-xl p-1.5 md:grid md:grid-cols-3 md:gap-1">
          <TabsTrigger 
            value="upcoming"
            className="w-full min-h-[44px] justify-center gap-1.5 px-3 py-2.5 text-sm whitespace-normal data-[state=active]:bg-[#058A77] data-[state=active]:text-white"
            data-testid="tab-upcoming"
          >
            <Clock className="w-4 h-4 shrink-0" />
            <span>Upcoming</span>
            {taskCounts && taskCounts.upcoming > 0 && (
              <Badge variant="secondary" className="shrink-0 px-1.5 py-0.5 text-xs">
                {taskCounts.upcoming}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger 
            value="overdue"
            className="w-full min-h-[44px] justify-center gap-1.5 px-3 py-2.5 text-sm whitespace-normal data-[state=active]:bg-[#058A77] data-[state=active]:text-white"
            data-testid="tab-overdue"
          >
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>Overdue</span>
            {taskCounts && taskCounts.overdue > 0 && (
              <Badge variant="destructive" className="shrink-0 px-1.5 py-0.5 text-xs">
                {taskCounts.overdue}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger 
            value="completed"
            className="w-full min-h-[44px] justify-center gap-1.5 px-3 py-2.5 text-sm whitespace-normal data-[state=active]:bg-[#058A77] data-[state=active]:text-white"
            data-testid="tab-completed"
          >
            <CheckCircle className="w-4 h-4 shrink-0" />
            <span>Completed</span>
            {taskCounts && taskCounts.completed > 0 && (
              <Badge variant="secondary" className="shrink-0 px-1.5 py-0.5 text-xs">
                {taskCounts.completed}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Task Lists */}
        <div className="min-h-[500px]">
          {isLoading ? (
            <Card>
              <CardContent className="py-12">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
                  <p className="text-muted-foreground">Loading tasks...</p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {filteredAndSortedTasks.length === 0 ? (
                <Card>
                  <CardContent className="py-12">
                    <div className="text-center">
                      <CheckCircle className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                      <p className="text-lg font-medium text-muted-foreground mb-2">No tasks found</p>
                      <p className="text-sm text-muted-foreground">
                        {selectedTab === 'today' ? "You're all caught up for today!" : 
                         selectedTab === 'completed' ? "No completed tasks yet." :
                         selectedTab === 'overdue' ? "Great! No overdue tasks." :
                         "No upcoming tasks found."}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                filteredAndSortedTasks.map((task) => {
                  const status = getTaskStatus(task);
                  const StatusIcon = status.icon;
                  
                  return (
                    <Card 
                      key={task.id} 
                      className="rounded-xl border hover:shadow-md transition-all duration-200 cursor-pointer"
                      data-testid={`task-${task.id}`}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <div className={cn("p-2 rounded-lg shrink-0", status.color)}>
                            <StatusIcon className="w-4 h-4" />
                          </div>
                          
                          <div className="flex-1 min-w-0 space-y-2">
                            <div className="flex items-start justify-between gap-2">
                              <h3 className="font-medium text-foreground line-clamp-2">{task.title}</h3>
                              <span className="text-lg shrink-0">{getEntityIcon(task.entityType)}</span>
                            </div>
                            
                            {task.description && (
                              <p className="text-sm text-muted-foreground line-clamp-2">{task.description}</p>
                            )}
                            
                            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
                              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                                <Calendar className="w-3 h-3 shrink-0" />
                                <span>{getTaskDateText(task.dueDate)}</span>
                              </div>
                              
                              <div className="flex items-center gap-1 text-sm text-muted-foreground min-w-0">
                                <User className="w-3 h-3 shrink-0" />
                                <span className="truncate">{task.entityName}</span>
                              </div>
                              
                              {task.tags && task.tags.map(tag => (
                                <Badge key={tag} variant="secondary" className="text-xs w-fit">
                                  <Tag className="w-3 h-3 mr-1" />
                                  {tag}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })
              )}
            </div>
          )}
        </div>
      </Tabs>
    </div>
  );
}