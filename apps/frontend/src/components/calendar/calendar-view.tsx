import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Plus, Filter, Search, Clock, AlertTriangle, CheckCircle, X, Printer, FileText, Car, Home, Trash2, RefreshCw, Mail, MessageCircle, Bell, Menu } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  format, 
  startOfMonth, 
  endOfMonth, 
  eachDayOfInterval, 
  isSameMonth, 
  isSameDay, 
  addMonths, 
  subMonths, 
  isToday, 
  startOfWeek, 
  endOfWeek,
  addDays,
  isBefore,
  isAfter,
  getDay,
  setMonth,
  setYear,
  getMonth,
  getYear
} from "date-fns";
import { cn, formatUTCasIST } from "@/lib/utils";
import { classifyYmdStatus, toISTYmd } from "@/lib/ymd-status";
import { TaskCompletionDialog } from "@/components/task-completion-dialog";
import { ReminderDisplay } from "@/components/reminder-display";
import { isDueTodayOrPast, formatDueDateMessage } from "@/lib/date-guards";
import QuickEventModal from "@/components/modals/quick-event-modal";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { optimisticDelete, rollbackCalendarQueries, invalidateAllQueries } from "@/lib/optimistic-updates";
import { apiRequest } from "@/lib/queryClient";
import { completeTaskOrOccurrence } from "@/lib/complete-flow";
import { getHeaderStatus } from "@/lib/header-status";
import { normalizeOccurrenceIso } from "@/lib/occurrence-key";
import { buildTaskOccurrences } from "@/lib/occurrence-engine";
import { calendarEntityTypeToApiEntityType, calendarEntityTypeToReminderEntityType, getEntityApiPath } from "@/lib/calendar-entity-type-mapper";
import { ConfirmDeleteByNameDialog } from "@/components/common/ConfirmDeleteByNameDialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

interface CalendarItem {
  id: string;
  title: string;
  dueDate: Date;
  category: string;
  status: string;
  entityType: 'tax' | 'vehicle' | 'asset' | 'event' | 'task_action_item' | 'tax_legal_item';
  amount?: number;
  vehicleId?: string | null;
  vehicleName?: string | null;
  // Recurring occurrence metadata
  isRecurringOccurrence?: boolean;
  seriesMasterId?: string | null;
  recurrenceData?: any;
  occurrenceTaskDateUtcIso?: string | null;
  // ⭐ Stable calendar day for reliable grouping (no timezone bugs)
  dueDateLocalYmd?: string; // "YYYY-MM-DD" in user's timezone (IST)
  // Reminder metadata (for statusRange calculation)
  reminderTimes?: string[];
}

type ViewMode = 'month' | 'week' | 'day';

export default function CalendarView() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedEvent, setSelectedEvent] = useState<CalendarItem | null>(null);
  const [showQuickEventModal, setShowQuickEventModal] = useState(false);
  const [quickEventDate, setQuickEventDate] = useState<Date>(new Date());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  
  // Day events popover state (Google Calendar style)
  const [dayPopover, setDayPopover] = useState<{
    date: Date;
    events: CalendarItem[];
    isOpen: boolean;
  } | null>(null);

  // ⭐ Use shared mapper to avoid duplication and inconsistency
  const resolveEntityTypeForApi = calendarEntityTypeToApiEntityType;

  const isRecurring = !!selectedEvent?.recurrenceData;

  // Always use the series master id when present (avoids passing occurrence_key to task completion)
  const entityIdForApi = useMemo(() => {
    if (!selectedEvent) return null;
    const seriesId = (selectedEvent as any).seriesMasterId;
    if (typeof seriesId === "string" && seriesId.length > 0) {
      return seriesId;
    }
    return selectedEvent.id ?? null;
  }, [selectedEvent]);

  const occurrenceTaskDateUtcIso = useMemo(() => {
    if (!selectedEvent) return null;
    const precomputed = (selectedEvent as any).occurrenceTaskDateUtcIso;
    if (typeof precomputed === "string" && precomputed.length > 0) {
      return normalizeOccurrenceIso(precomputed);
    }
    // No fallback to first occurrence; if not provided, treat as series-level
    return null;
  }, [selectedEvent]);

  // ✅ For completion: derive occurrence ISO with fallback to dueDate
  // This ensures DB-driven completion works for both recurring and non-recurring tasks
  const completionOccurrenceIso = useMemo(() => {
    if (!selectedEvent) return null;
    const precomputed = (selectedEvent as any).occurrenceTaskDateUtcIso;
    if (typeof precomputed === "string" && precomputed.length > 0) {
      return normalizeOccurrenceIso(precomputed);
    }
    // ✅ Fallback for non-recurring / DB-driven single occurrences
    // Use the selected event's dueDate as the occurrence instant
    if (selectedEvent.dueDate) {
      return normalizeOccurrenceIso(new Date(selectedEvent.dueDate).toISOString());
    }
    return null;
  }, [selectedEvent]);

  // ✅ One ISO for status lookups (must match completion ISO)
  const effectiveOccurrenceIsoForStatus = useMemo(() => {
    if (!selectedEvent) return null;
    // Prefer true occurrenceTaskDateUtcIso if provided
    if (occurrenceTaskDateUtcIso) return occurrenceTaskDateUtcIso;
    // ✅ Fallback for DB-driven non-recurring: use the same fallback used for completion
    return completionOccurrenceIso;
  }, [selectedEvent, occurrenceTaskDateUtcIso, completionOccurrenceIso]);

  const completeOccurrenceMutation = useMutation({
    mutationFn: async (notes: string) => {
      if (!selectedEvent || !entityIdForApi) {
        throw new Error("Missing event");
      }

      const entityType = resolveEntityTypeForApi(selectedEvent.entityType);
      
      // ✅ Debug logging
      console.log("[completion]", {
        entityType,
        entityId: entityIdForApi,
        isRecurring,
        completionOccurrenceIso,
        selectedOccurrenceKey,
        dueDate: selectedEvent.dueDate,
      });
      
      await completeTaskOrOccurrence({
        entityType,
        entityId: entityIdForApi,
        isRecurring,
        occurrenceTaskDateUtcIso,
        occurrenceKey: selectedOccurrenceKey ?? null, // ⚠️ null (not undefined) for DevTools visibility
        notes,
        apiRequest,
      });
    },
    onSuccess: async () => {
      // ✅ Optimistic: mark current modal instantly
      setSelectedEvent((prev) => (prev ? { ...prev, status: "completed" } : prev));
      
      // ✅ Optimistic: update occ-status cache for non-recurring so badge flips immediately
      if (!isRecurring && selectedOccurrenceKey) {
        queryClient.setQueryData(
          [
            "occ-status",
            selectedEvent ? resolveEntityTypeForApi(selectedEvent.entityType) : null,
            entityIdForApi,
            effectiveOccurrenceIsoForStatus,
          ],
          { status: "completed" }
        );
      }
      
      // ✅ Optimistic: update occ-statuses cache for recurring so badge flips immediately
      if (isRecurring && selectedOccurrenceKey && statusRange) {
        queryClient.setQueryData(
          [
            "occ-statuses-map",
            resolvedEntityType,
            entityIdForApi,
            statusRange.from ?? null,
            statusRange.to ?? null,
          ],
          (oldData: any) => ({
            ...oldData,
            [selectedOccurrenceKey]: { status: "completed" }
          })
        );
      }
      
      // ✅ Always refresh the grid source of truth
      await queryClient.invalidateQueries({ queryKey: ["calendar-items"] });
      
      // ✅ For recurring: invalidate (not refetch) to allow optimistic update to persist
      // The query will background-sync when appropriate without immediately overwriting
      if (isRecurring && statusRange) {
        queryClient.invalidateQueries({
          queryKey: [
            "occ-statuses-map",
            resolvedEntityType,
            entityIdForApi,
            statusRange.from ?? null,
            statusRange.to ?? null,
          ],
        });
      } else if (effectiveOccurrenceIsoForStatus) {
        occurrenceStatusQuery.refetch();
      }
      
      toast({
        title: "Marked complete",
        description: "This occurrence has been marked as completed.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Unable to complete",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const [completionDialogOpen, setCompletionDialogOpen] = useState(false);
  
  // Mobile detection for responsive behavior
  const [isMobile, setIsMobile] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  
  // Detect mobile on mount and resize
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const startDate = viewMode === 'month' 
    ? startOfMonth(currentDate)
    : viewMode === 'week'
    ? startOfWeek(currentDate)
    : currentDate;
    
  const endDate = viewMode === 'month'
    ? endOfMonth(currentDate)
    : viewMode === 'week'
    ? endOfWeek(currentDate)
    : currentDate;

  const resolvedEntityType = selectedEvent ? resolveEntityTypeForApi(selectedEvent.entityType) : null;
  const resolvedEntityId = entityIdForApi ?? selectedEvent?.id ?? null;

  // Compute a status query range for recurring series (full range, not just selected occurrence)
  const statusRange = useMemo(() => {
    if (!selectedEvent?.recurrenceData || !entityIdForApi) return null;

    const recurrence = selectedEvent.recurrenceData;
    const endCount =
      recurrence.endType === "after" ? Number(recurrence.endCount ?? 0) : 0;

    // If we have a finite count, compute exact first/last occurrence instants
    if (endCount > 0) {
      const taskTimeIst =
        Array.isArray((selectedEvent as any).reminderTimes) &&
        (selectedEvent as any).reminderTimes[0]
          ? (selectedEvent as any).reminderTimes[0]
          : "09:00";
      try {
        const { taskDatesUtc } = buildTaskOccurrences({
          recurrence,
          seriesStart: new Date(selectedEvent.dueDate),
          count: endCount,
          taskTimeIst,
        });
        const from = taskDatesUtc[0]?.toISOString();
        const toLast = taskDatesUtc[taskDatesUtc.length - 1]?.toISOString();
        if (!from || !toLast) return null;
        const to = new Date(new Date(toLast).getTime() + 1000).toISOString();
        return { from, to };
      } catch {
        // fall through to view-range fallback
      }
    }

    // Fallback: use current view window (inclusive end +1 day buffer)
    const from = new Date(startDate);
    from.setHours(0, 0, 0, 0);
    const to = new Date(endDate);
    to.setHours(23, 59, 59, 999);
    return { from: from.toISOString(), to: new Date(to.getTime() + 1000).toISOString() };
  }, [selectedEvent, entityIdForApi, startDate, endDate]);

  // Construct API URL with query parameters
  const startDateStr = format(startDate, 'yyyy-MM-dd');
  const endDateStr = format(endDate, 'yyyy-MM-dd');
  const apiUrl = `/api/calendar/items?start=${startDateStr}&end=${endDateStr}`;

  const occurrenceStatusQuery = useQuery({
    queryKey: [
      "occ-status",
      selectedEvent ? resolveEntityTypeForApi(selectedEvent.entityType) : null,
      entityIdForApi,
      effectiveOccurrenceIsoForStatus,
    ],
    queryFn: async () => {
      if (!selectedEvent || !effectiveOccurrenceIsoForStatus || !entityIdForApi) return null;
      const entityType = resolveEntityTypeForApi(selectedEvent.entityType);
      const url = `/api/task-occurrence/current?entityType=${encodeURIComponent(
        entityType
      )}&entityId=${encodeURIComponent(entityIdForApi)}&taskDateUtcIso=${encodeURIComponent(
        effectiveOccurrenceIsoForStatus
      )}`;
      return apiRequest("GET", url);
    },
    enabled: !!selectedEvent && !!effectiveOccurrenceIsoForStatus && !!entityIdForApi && !isRecurring,
    staleTime: 30_000,
  });

  // Occurrence statuses map (range) for recurring tasks
  const occurrenceStatusesQuery = useQuery({
    queryKey: [
      "occ-statuses-map",
      resolvedEntityType,
      entityIdForApi,
      statusRange?.from ?? null,
      statusRange?.to ?? null,
    ],
    queryFn: async () => {
      if (!selectedEvent || !isRecurring || !entityIdForApi || !resolvedEntityType || !statusRange) return {};
      const entityType = resolvedEntityType;
      const entityId = entityIdForApi;
      const params = new URLSearchParams({
        entityType,
        entityId,
        from: statusRange.from,
        to: statusRange.to,
      });
      return apiRequest("GET", `/api/task-occurrence/statuses?${params.toString()}`);
    },
    enabled: !!selectedEvent && !!isRecurring && !!entityIdForApi && !!resolvedEntityType && !!statusRange,
    staleTime: 30_000,
  });

  // ✅ Compute occurrenceKey for BOTH recurring and non-recurring tasks
  // Non-recurring tasks with DB-driven reminders ALSO need occurrenceKey for completion
  // Format matches DB: <entityId>::<ISO> (no entityType prefix)
  const selectedOccurrenceKey =
    completionOccurrenceIso && resolvedEntityId
      ? `${resolvedEntityId}::${completionOccurrenceIso}`
      : null;
  const recurringSelectedStatus =
    selectedOccurrenceKey && isRecurring
      ? (occurrenceStatusesQuery.data as any)?.[selectedOccurrenceKey]?.status ?? null
      : null;
  const effectiveOccurrenceStatus = isRecurring
    ? (recurringSelectedStatus ?? selectedEvent?.status ?? null)
    : (occurrenceStatusQuery.data as any)?.status ?? null;
  const selectedOccurrenceCompleted = effectiveOccurrenceStatus === "completed";

  // ✅ Unified status map for both recurring and non-recurring (TOP-LEVEL HOOK)
  const headerStatusesMap = useMemo(() => {
    if (!selectedOccurrenceKey) return undefined;
    
    if (isRecurring) {
      return occurrenceStatusesQuery.data as any;
    }
    
    const s = (occurrenceStatusQuery.data as any)?.status;
    if (!s) return undefined;
    
    // Shape matches statusesMap consumption: map[key] = { status: "completed" | ... }
    return { [selectedOccurrenceKey]: { status: s } };
  }, [
    isRecurring,
    selectedOccurrenceKey,
    occurrenceStatusesQuery.data,
    occurrenceStatusQuery.data,
  ]);

  // ⭐ Use semantic query key + explicit queryFn for reliability
  const { data: items, isLoading } = useQuery<CalendarItem[]>({
    queryKey: ["calendar-items", startDateStr, endDateStr],
    queryFn: () => apiRequest<CalendarItem[]>("GET", apiUrl),
  });

  const filteredItems = useMemo(() => {
    if (!items) return [];
    
    let filtered = items;
    
    // Filter by category
    if (categoryFilter !== "all") {
      filtered = filtered.filter(item => {
        switch (categoryFilter) {
          case "vehicle":
            return item.entityType === "vehicle";
          case "asset":
            return item.entityType === "asset";
          case "task_action":
            return item.entityType === "task_action_item";
          case "tax_legal":
            return item.entityType === "tax_legal_item";
          default:
            return true;
        }
      });
    }
    
    // Filter by search
    if (searchQuery) {
      filtered = filtered.filter(item => 
        item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.category.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    
    return filtered;
  }, [items, categoryFilter, searchQuery]);

  const calendarDays = useMemo(() => {
    if (viewMode === 'day') return [currentDate];
    
    if (viewMode === 'week') {
      const weekStart = startOfWeek(currentDate);
      return eachDayOfInterval({ 
        start: weekStart, 
        end: addDays(weekStart, 6) 
      });
    }
    
    // Month view
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);
    
    // Get all days from start of first week to end of last week
    const startDate = new Date(monthStart);
    startDate.setDate(startDate.getDate() - monthStart.getDay());
    
    const endDate = new Date(monthEnd);
    endDate.setDate(endDate.getDate() + (6 - monthEnd.getDay()));
    
    return eachDayOfInterval({ start: startDate, end: endDate });
  }, [currentDate, viewMode]);

  const getItemsForDate = (date: Date) => {
    const dateYmd = format(date, 'yyyy-MM-dd'); // ⭐ Use stable YYYY-MM-DD for comparison
    return filteredItems.filter(item => {
      // Prefer dueDateLocalYmd for reliability (no timezone bugs)
      if (item.dueDateLocalYmd) {
        return item.dueDateLocalYmd === dateYmd;
      }
      // Fallback to old logic for backward compatibility
      return isSameDay(new Date(item.dueDate), date);
    });
  };

  const getItemStatusColor = (item: CalendarItem) => {
    if (item.status === 'completed') {
      return 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 border-green-200 dark:border-green-700';
    }
    
    // ✅ FIX: Use IST day strings for timezone-proof status classification
    const todayYmd = toISTYmd(new Date());
    const dueYmd = item.dueDateLocalYmd ?? toISTYmd(new Date(item.dueDate));
    const status = classifyYmdStatus(dueYmd, todayYmd);
    
    if (status === 'overdue') {
      return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300 border-red-200 dark:border-red-700';
    }
    
    if (status === 'today') {
      return 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300 border-orange-200 dark:border-orange-700';
    }
    
    return 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 border-blue-200 dark:border-blue-700';
  };

  const handleDateClick = (date: Date) => {
    const dayEvents = getItemsForDate(date);
    
    if (dayEvents.length === 0) {
      // No events - open Quick Event modal directly
      setQuickEventDate(date);
      setShowQuickEventModal(true);
    } else if (isMobile) {
      // Mobile - use modal for better UX
      setDayPopover({
        date,
        events: dayEvents,
        isOpen: true
      });
    } else {
      // Desktop - use popover (Google Calendar style)
      setDayPopover({
        date,
        events: dayEvents,
        isOpen: true
      });
    }
  };

  const handleAddEvent = () => {
    setQuickEventDate(new Date());
    setShowQuickEventModal(true);
  };

  const handleEventClickFromPopover = (event: CalendarItem) => {
    setDayPopover(null); // Close popover
    console.log("[calendar-click]", {
      id: event.id,
      seriesMasterId: (event as any).seriesMasterId,
      occIso: (event as any).occurrenceTaskDateUtcIso,
      dueDate: event.dueDate,
    });
    setSelectedEvent(event);
  };

  const getCategoryColor = (category: string, entityType: string) => {
    const colors: Record<string, string> = {
      tax: 'bg-purple-500',
      vehicle: 'bg-blue-500', 
      asset: 'bg-green-500',
      task_action_item: 'bg-orange-500',
      tax_legal_item: 'bg-indigo-500'
    };
    return colors[entityType] || 'bg-gray-500';
  };

  const getEventIcon = (item: CalendarItem) => {
    // Priority: Status first, then entity type
    if (item.status === 'completed') {
      return { Icon: CheckCircle, color: 'text-green-600' };
    }
    
    if (isBefore(new Date(item.dueDate), new Date())) {
      return { Icon: AlertTriangle, color: 'text-red-600' };
    }
    
    // For pending/upcoming items, use entity-specific icons
    switch (item.entityType) {
      case 'tax':
        return { Icon: FileText, color: 'text-purple-600' };
      case 'vehicle':
        return { Icon: Car, color: 'text-blue-600' };
      case 'asset':
        return { Icon: Home, color: 'text-green-600' };
      case 'event':
        return { Icon: CalendarIcon, color: 'text-indigo-600' };
      case 'task_action_item':
        return { Icon: CheckCircle, color: 'text-orange-600' };
      case 'tax_legal_item':
        return { Icon: FileText, color: 'text-indigo-600' };
      default:
        return { Icon: Clock, color: 'text-gray-600' };
    }
  };

  const navigateDate = (direction: 'prev' | 'next') => {
    if (viewMode === 'month') {
      setCurrentDate(direction === 'next' ? addMonths(currentDate, 1) : subMonths(currentDate, 1));
    } else if (viewMode === 'week') {
      setCurrentDate(direction === 'next' ? addDays(currentDate, 7) : addDays(currentDate, -7));
    } else {
      setCurrentDate(direction === 'next' ? addDays(currentDate, 1) : addDays(currentDate, -1));
    }
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  const handleMonthChange = (monthIndex: string) => {
    setCurrentDate(setMonth(currentDate, parseInt(monthIndex)));
  };

  const handleYearChange = (year: string) => {
    setCurrentDate(setYear(currentDate, parseInt(year)));
  };

  const handlePrint = () => {
    // Gate the print to only affect calendar (prevents sidebar from showing)
    document.body.setAttribute("data-print", "calendar");
    
    const cleanup = () => {
      document.body.removeAttribute("data-print");
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    
    // Small delay to let browser repaint before printing
    setTimeout(() => window.print(), 100);
  };

  // Delete mutation with optimistic updates
  const deleteMutation = useMutation({
    mutationFn: async (item: CalendarItem) => {
      // ⭐ CRITICAL: For expanded occurrences, delete the base entity (seriesMasterId), not the synthetic occurrence ID
      // Synthetic IDs look like: "uuid::2025-12-24T03:30:00.000Z"
      let entityIdToDelete = item.id;
      
      // If this is an expanded occurrence, use the master ID instead
      if (item.seriesMasterId) {
        entityIdToDelete = item.seriesMasterId;
      } 
      // Fallback: if ID contains "::" (synthetic), extract base ID
      else if (typeof item.id === 'string' && item.id.includes('::')) {
        entityIdToDelete = item.id.split('::')[0];
      }
      
      const basePath = getEntityApiPath(item.entityType);
      const endpoint = `${basePath}/${entityIdToDelete}`;
      
      const response = await fetch(endpoint, {
        method: 'DELETE',
        credentials: 'include',
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Failed to delete item');
      }
      
      // 204 No Content has no response body, don't try to parse JSON
      return null;
    },
    // Optimistic update - remove item immediately from UI
    onMutate: async (deletedItem) => {
      // Use reusable optimistic delete utility
      const context = await optimisticDelete(queryClient, deletedItem.id);
      
      // Close the modal immediately for instant feedback
      setSelectedEvent(null);
      setShowDeleteConfirm(false);
      
      return context;
    },
    onSuccess: () => {
      // Show success toast
      toast({
        title: "Deleted Successfully",
        description: "The item and its reminders have been removed",
      });
    },
    onError: (error: Error, deletedItem, context) => {
      // Rollback using utility
      if (context?.previousData) {
        rollbackCalendarQueries(queryClient, context.previousData);
      }
      
      // Show error toast
      toast({
        title: "Error",
        description: error.message || "Failed to delete item",
        variant: "destructive",
      });
      
      // Close confirmation dialog
      setShowDeleteConfirm(false);
    },
    // Always refetch after error or success to sync with server
    // Use comprehensive invalidation to ensure consistency across entire app
    onSettled: () => {
      invalidateAllQueries(queryClient);
    },
  });

  const handleDeleteClick = () => {
    setShowDeleteConfirm(true);
  };

  const renderMiniCalendar = () => {
    const today = new Date();
    const miniCalendarDays = eachDayOfInterval({
      start: startOfMonth(currentDate),
      end: endOfMonth(currentDate)
    });
    
    // Pad with empty cells for proper alignment
    const firstDay = startOfMonth(currentDate);
    const startPadding = getDay(firstDay);
    const paddingCells = Array(startPadding).fill(null);
    
    return (
      <div className="p-4">
        <div className="text-sm font-medium text-center mb-3 text-foreground">
          {format(currentDate, 'MMMM yyyy')}
        </div>
        <div className="grid gap-1 text-xs" style={{ gridTemplateColumns: 'repeat(7, minmax(32px, 1fr))' }}>
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => (
            <div key={`mini-day-${index}`} className="h-8 min-w-[32px] flex items-center justify-center text-muted-foreground font-medium">
              {day}
            </div>
          ))}
          {paddingCells.map((_, index) => (
            <div key={`padding-${index}`} className="h-8 min-w-[32px]" />
          ))}
          {miniCalendarDays.map((day, index) => {
            const hasItems = getItemsForDate(day).length > 0;
            const isSelected = isSameDay(day, selectedDate);
            const isTodayDate = isToday(day);
            
            return (
              <button
                key={index}
                onClick={() => setSelectedDate(day)}
                className={cn(
                  "h-8 min-w-[32px] flex items-center justify-center rounded-full text-xs transition-all duration-200 hover:bg-muted",
                  isSelected && "bg-primary text-primary-foreground",
                  isTodayDate && !isSelected && "bg-accent text-accent-foreground",
                  hasItems && !isSelected && "bg-muted font-medium"
                )}
              >
                {format(day, 'd')}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const renderEventCard = (item: CalendarItem, compact = false) => {
    const statusColor = getItemStatusColor(item);
    const { Icon, color } = getEventIcon(item);
    
    return (
      <div
        key={item.id}
        className={cn(
          "rounded-lg transition-all duration-200 hover:shadow-md cursor-pointer overflow-hidden",
          statusColor,
          compact ? "text-xs py-1 px-1.5" : "text-sm p-2"
        )}
        onClick={(e) => {
          e.stopPropagation(); // ✅ Fix: Prevent day click when clicking event
          setSelectedEvent(item);
        }}
      >
        <div className="flex items-start gap-1.5">
          <Icon className={cn("flex-shrink-0 mt-0.5", compact ? "w-3 h-3" : "w-3.5 h-3.5", color)} />
          <span className={cn("font-medium break-words", compact ? "text-xs" : "text-sm")}>
            {item.title}
            {item.isRecurringOccurrence && (
                        <RefreshCw className="w-3 h-3 inline ml-1 opacity-60" />
            )}
          </span>
        </div>
        {!compact && (
          <div className="mt-1 ml-5 text-xs opacity-75">
            {item.category} • {item.entityType}
            {item.amount && ` • ₹${item.amount.toLocaleString()}`}
          </div>
        )}
      </div>
    );
  };

  const renderSidebarPanel = () => (
    <>
      <Card className="m-4 shadow-md">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">Calendar</h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCurrentDate(new Date())}
              className="text-xs min-h-[44px]"
            >
              Today
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {renderMiniCalendar()}
        </CardContent>
      </Card>

      <div className="p-4 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search events..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 text-sm shadow-md"
          />
        </div>

        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="text-sm shadow-md w-full">
            <Filter className="w-4 h-4 mr-2" />
            <SelectValue placeholder="Filter" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            <SelectItem value="vehicle">Vehicles</SelectItem>
            <SelectItem value="asset">Assets</SelectItem>
            <SelectItem value="task_action">Task Actions</SelectItem>
            <SelectItem value="tax_legal">Tax & Legal</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="p-4">
          <h3 className="font-semibold text-sm mb-3">Upcoming Events</h3>
          <div className="space-y-2">
            {filteredItems
              .filter(item => isAfter(new Date(item.dueDate), new Date()) || isSameDay(new Date(item.dueDate), new Date()))
              .slice(0, 8)
              .map(item => renderEventCard(item, true))
            }
            {filteredItems.length === 0 && (
              <p className="text-sm text-muted-foreground">No upcoming events</p>
            )}
          </div>
        </div>
      </div>
    </>
  );

  const agendaDays = useMemo(() => {
    if (viewMode === 'day') return [currentDate];
    return calendarDays.filter((day) => viewMode === 'week' || isSameMonth(day, currentDate));
  }, [viewMode, calendarDays, currentDate]);

  const renderMobileAgenda = () => (
    <div className="sm:hidden space-y-3 pb-4">
      {agendaDays.map((day) => {
        const dayItems = getItemsForDate(day);
        const isTodayDate = isToday(day);

        return (
          <div
            key={day.toString()}
            className={cn(
              "bg-card rounded-xl p-4 shadow-sm border",
              isTodayDate && "ring-2 ring-primary/30"
            )}
          >
            <button
              type="button"
              onClick={() => handleDateClick(day)}
              className="w-full text-left mb-2 min-h-[44px]"
            >
              <div className="flex items-center justify-between gap-2">
                <span className={cn("font-semibold text-sm", isTodayDate && "text-primary")}>
                  {format(day, 'EEE, MMM d')}
                </span>
                <span className="text-xs text-muted-foreground">
                  {dayItems.length} {dayItems.length === 1 ? 'event' : 'events'}
                </span>
              </div>
            </button>
            {dayItems.length > 0 ? (
              <div className="space-y-2">
                {dayItems.map((item) => (
                  <div key={item.id} className="min-w-0">
                    {renderEventCard(item)}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No events</p>
            )}
          </div>
        );
      })}
    </div>
  );

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  // Format month label for print title
  const monthLabel = format(currentDate, 'MMMM yyyy');

  return (
    <>
      <div 
        id="calendar-print-root"
        className="h-full flex flex-col lg:flex-row bg-background shadow-md" 
        data-testid="fantastical-calendar" 
        data-density="cozy"
        style={{ ['--print-month-name' as any]: `"${monthLabel}"` }}
      >
      {/* Sidebar - desktop */}
      <div className="hidden lg:flex w-80 shrink-0 shadow-md bg-card flex-col">
        {renderSidebarPanel()}
      </div>

      {/* Main Calendar Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="shadow-md bg-card p-3 sm:p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2 sm:gap-4 min-w-0">
              <Button
                variant="ghost"
                size="sm"
                className="lg:hidden min-h-[44px]"
                onClick={() => setSidebarOpen(true)}
                aria-label="Open calendar sidebar"
              >
                <Menu className="w-5 h-5" />
              </Button>
              {viewMode === 'month' && (
                <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                  <Select value={getMonth(currentDate).toString()} onValueChange={handleMonthChange}>
                    <SelectTrigger className="w-full sm:w-[140px] shadow-sm border-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {['January', 'February', 'March', 'April', 'May', 'June', 
                        'July', 'August', 'September', 'October', 'November', 'December'].map((month, index) => (
                        <SelectItem key={index} value={index.toString()}>
                          {month}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  
                  <Select value={getYear(currentDate).toString()} onValueChange={handleYearChange}>
                    <SelectTrigger className="w-full sm:w-[100px] shadow-sm border-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 11 }, (_, i) => getYear(new Date()) - 5 + i).map((year) => (
                        <SelectItem key={year} value={year.toString()}>
                          {year}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              
              <div className="flex items-center gap-1 sm:gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={goToToday}
                  className="px-3 shadow-sm border-0 min-h-[44px]"
                >
                  Today
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigateDate('prev')}
                  className="shadow-sm border-0 min-h-[44px] min-w-[44px]"
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigateDate('next')}
                  className="shadow-sm border-0 min-h-[44px] min-w-[44px]"
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>

              {viewMode !== 'month' && (
              <h1 className="text-lg sm:text-2xl font-semibold text-foreground w-full sm:w-auto">
                {viewMode === 'week' && `Week of ${format(startOfWeek(currentDate), 'MMM d, yyyy')}`}
                {viewMode === 'day' && format(currentDate, 'EEEE, MMMM d, yyyy')}
              </h1>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 sm:gap-3 w-full sm:w-auto">
              <div className="flex bg-muted rounded-lg p-1 gap-1 w-full sm:w-auto">
                {(['month', 'week', 'day'] as ViewMode[]).map((mode) => (
                  <Button
                    key={mode}
                    variant={viewMode === mode ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setViewMode(mode)}
                    className={cn(
                      "flex-1 sm:flex-none px-3 py-1 text-sm capitalize min-h-[44px]",
                      viewMode === mode 
                        ? "bg-background shadow-sm border-0" 
                        : "hover:bg-background/50 border-0"
                    )}
                  >
                    {mode}
                  </Button>
                ))}
              </div>
              
              <Button 
                size="sm" 
                variant="ghost"
                onClick={handlePrint}
                data-testid="button-print-calendar"
                className="shadow-sm border-0 hidden sm:inline-flex min-h-[44px]"
              >
                <Printer className="w-4 h-4 mr-2" />
                Print
              </Button>
              
              <Button 
                size="sm" 
                onClick={handleAddEvent} 
                data-testid="button-add-event"
                className="shadow-sm border-0 rounded-[35px] flex-1 sm:flex-none min-h-[44px]"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Event
              </Button>
            </div>
          </div>
        </div>

        {/* Calendar Grid / Mobile Agenda */}
        <div className="flex-1 overflow-auto p-3 sm:p-4">
          {(viewMode === 'month' || viewMode === 'week') && renderMobileAgenda()}
          {viewMode === 'month' && (
            <div className="hidden sm:grid grid-cols-7 gap-px bg-border overflow-hidden h-full">
              {/* Week headers */}
              {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => (
                <div key={`week-${day}-${index}`} className="bg-muted/50 p-3 text-xs font-normal text-center text-muted-foreground uppercase tracking-wide">
                  {day}
                </div>
              ))}
              
              {/* Calendar days */}
              {calendarDays.map((day, index) => {
                const dayItems = getItemsForDate(day);
                const isCurrentMonth = isSameMonth(day, currentDate);
                const isTodayDate = isToday(day);
                
                // Hide dates from previous/next months
                if (!isCurrentMonth) {
                  return (
                    <div
                      key={index}
                      className="bg-muted/10 min-h-32"
                    />
                  );
                }
                
                return (
                  <div
                    key={index}
                    onClick={() => handleDateClick(day)}
                    className={cn(
                      "bg-card p-2 min-h-32 border-0 cursor-pointer hover:bg-muted/50 transition-colors",
                      isTodayDate && "bg-accent/50"
                    )}
                    aria-current={isTodayDate ? "date" : undefined}
                    data-testid={`calendar-date-${format(day, 'yyyy-MM-dd')}`}
                  >
                    <div className={cn(
                      "text-sm font-normal mb-2",
                      isTodayDate && "text-accent-foreground"
                    )}>
                      {format(day, 'd')}
                    </div>
                    
                    <div className="space-y-0.5">
                      {dayItems.slice(0, 3).map(item => renderEventCard(item, true))}
                      {dayItems.length > 3 && (
                        <div className="text-xs text-muted-foreground text-center py-1">
                          +{dayItems.length - 3} more
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {viewMode === 'week' && (
            <div className="hidden sm:grid grid-cols-7 gap-4 h-full">
              {calendarDays.map((day) => {
                const dayItems = getItemsForDate(day);
                const isTodayDate = isToday(day);
                
                return (
                  <div key={day.toString()} className="flex flex-col">
                    <div className={cn(
                      "text-center p-3 rounded-lg mb-4",
                      isTodayDate ? "bg-primary text-primary-foreground" : "bg-muted"
                    )}>
                      <div className="text-sm font-medium">{format(day, 'EEE')}</div>
                      <div className="text-lg font-semibold">{format(day, 'd')}</div>
                    </div>
                    
                    <div className="flex-1 space-y-2">
                      {dayItems.map(item => renderEventCard(item))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {viewMode === 'day' && (
            <div className="max-w-2xl mx-auto">
              <div className="bg-card rounded-lg p-6 mb-6">
                <h2 className="text-xl font-semibold mb-2">
                  {format(currentDate, 'EEEE, MMMM d, yyyy')}
                </h2>
                <p className="text-muted-foreground">
                  {getItemsForDate(currentDate).length} events scheduled
                </p>
              </div>
              
              <div className="space-y-3">
                {getItemsForDate(currentDate).map(item => (
                  <div key={item.id} className="bg-card rounded-lg p-4 shadow-sm">
                    {renderEventCard(item)}
                  </div>
                ))}
                
                {getItemsForDate(currentDate).length === 0 && (
                  <div className="text-center py-12 text-muted-foreground">
                    <CalendarIcon className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>No events scheduled for this day</p>
                    <Button 
                      variant="outline" 
                      className="mt-4" 
                      onClick={() => handleDateClick(currentDate)}
                      data-testid="button-add-event-day-view"
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      Add Event
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        </div>
      </div>

      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="w-[min(100vw-2rem,320px)] p-0 overflow-y-auto flex flex-col">
          <SheetHeader className="px-4 pt-6 pb-2 border-b">
            <SheetTitle className="text-left">Calendar</SheetTitle>
          </SheetHeader>
          <div className="flex flex-col flex-1 overflow-hidden">
            {renderSidebarPanel()}
          </div>
        </SheetContent>
      </Sheet>

    {/* Day Events Popover/Modal (Google Calendar Style) */}
    {!isMobile && dayPopover && (
        <Dialog open={dayPopover.isOpen} onOpenChange={(open) => !open && setDayPopover(null)}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center justify-between">
                <span>{format(dayPopover.date, 'EEEE, MMMM d, yyyy')}</span>
              </DialogTitle>
              <DialogDescription>
                {dayPopover.events.length} {dayPopover.events.length === 1 ? 'event' : 'events'} scheduled
              </DialogDescription>
            </DialogHeader>
            
            <ScrollArea className="max-h-[400px] pr-4">
              <div className="space-y-2">
                {dayPopover.events.map(event => (
                  <div
                    key={event.id}
                    onClick={() => handleEventClickFromPopover(event)}
                    className={cn(
                      "p-4 border rounded-lg hover:bg-muted cursor-pointer transition-all"
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-2">
                          {(() => {
                            const { Icon, color } = getEventIcon(event);
                            return <Icon className={cn("w-3.5 h-3.5 flex-shrink-0", color)} />;
                          })()}
                          <span className="font-medium">{event.title}</span>
                        </div>
                        <div className="text-sm text-muted-foreground space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="capitalize">{event.category}</span>
                            <span>•</span>
                            <span className="capitalize">{event.entityType}</span>
                          </div>
                          {event.vehicleName && (
                            <div className="flex items-center gap-2">
                              <span>Vehicle:</span>
                              <span className="font-medium">{event.vehicleName}</span>
                            </div>
                          )}
                          {event.amount && (
                            <div className="flex items-center gap-2">
                              <span>Amount:</span>
                              <span className="font-medium">₹{event.amount.toLocaleString('en-IN')}</span>
                            </div>
                          )}
                        </div>
                      </div>
                      <Badge 
                        variant={event.status === 'completed' ? 'default' : 'outline'}
                        className={cn(
                          event.status === 'completed' && 'bg-green-100 text-green-800 border-green-200',
                          isBefore(new Date(event.dueDate), new Date()) && event.status !== 'completed' && 'bg-red-100 text-red-800 border-red-200'
                        )}
                      >
                        {event.status === 'completed' ? 'Completed' : 
                         isBefore(new Date(event.dueDate), new Date()) ? 'Overdue' : 'Upcoming'}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
            
            <DialogFooter className="sm:justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setDayPopover(null)}
              >
                Close
              </Button>
              <Button
                onClick={() => {
                  setQuickEventDate(dayPopover.date);
                  setShowQuickEventModal(true);
                  setDayPopover(null);
                }}
                className="rounded-[35px]"
              >
                <CalendarIcon className="w-4 h-4 mr-2" />
                Quick Event
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      
      {/* Mobile: Day Events Modal */}
      {isMobile && dayPopover && (
        <Dialog open={dayPopover.isOpen} onOpenChange={(open) => !open && setDayPopover(null)}>
          <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
            <DialogHeader>
              <DialogTitle>{format(dayPopover.date, 'EEEE, MMM d')}</DialogTitle>
              <DialogDescription>
                {dayPopover.events.length} {dayPopover.events.length === 1 ? 'event' : 'events'}
              </DialogDescription>
            </DialogHeader>
            
            <ScrollArea className="flex-1 -mx-6 px-6">
              <div className="space-y-2 py-2">
                {dayPopover.events.map(event => (
                  <div
                    key={event.id}
                    onClick={() => handleEventClickFromPopover(event)}
                    className={cn(
                      "p-3 shadow-md rounded-lg active:bg-muted cursor-pointer",
                      "min-h-[60px]"
                    )}
                  >
                    <div className="flex items-start gap-1.5">
                      {(() => {
                        const { Icon, color } = getEventIcon(event);
                        return <Icon className={cn("w-3.5 h-3.5 flex-shrink-0 mt-0.5", color)} />;
                      })()}
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm">{event.title}</div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {event.category}
                          {event.vehicleName && ` • ${event.vehicleName}`}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
            
            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setDayPopover(null)}
              >
                Close
              </Button>
              <Button
                className="flex-1 rounded-[35px]"
                onClick={() => {
                  setQuickEventDate(dayPopover.date);
                  setShowQuickEventModal(true);
                  setDayPopover(null);
                }}
              >
                <CalendarIcon className="w-4 h-4 mr-1" />
                Quick Event
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

    {/* Event Details Dialog */}
    {selectedEvent && (
      <Dialog open={!!selectedEvent} onOpenChange={(open) => !open && setSelectedEvent(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{selectedEvent.title}</DialogTitle>
            <DialogDescription>
              View and manage this task
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground mb-1">Category</p>
                <Badge variant="outline" className="capitalize border">{selectedEvent.category}</Badge>
              </div>
              <div>
                <p className="text-muted-foreground mb-1">Type</p>
                <Badge variant="outline" className="capitalize border">{selectedEvent.entityType}</Badge>
              </div>
              {selectedEvent.entityType === 'vehicle' && selectedEvent.vehicleName && (
                <div className="col-span-2">
                  <p className="text-muted-foreground mb-1">Vehicle</p>
                  <p className="font-medium">{selectedEvent.vehicleName}</p>
                </div>
              )}
              <div>
                <p className="text-muted-foreground mb-1">Due Date</p>
                <div className="flex items-center gap-2">
                  <CalendarIcon className="w-4 h-4" />
                  <span>{format(new Date(selectedEvent.dueDate), 'MMM d, yyyy')}</span>
                </div>
              </div>
              <div>
                <p className="text-muted-foreground mb-1">Status</p>
                {(() => {
                  // ✅ Uses top-level headerStatusesMap (no hooks in JSX!)
                  const status = getHeaderStatus({
                    isRecurring,
                    entityBaseStatus: selectedEvent?.status ?? "pending",
                    occurrenceKey: selectedOccurrenceKey,
                    statusesMap: headerStatusesMap as any,
                  });
                  const label =
                    status === "completed"
                      ? "Completed"
                      : status === "skipped"
                      ? "Skipped"
                      : "Pending";
                  const klass =
                    status === "completed"
                      ? "bg-green-100 text-green-800"
                      : status === "skipped"
                      ? "bg-gray-200 text-gray-800"
                      : "bg-blue-100 text-blue-800";
                  return <Badge className={cn(klass)}>{label}</Badge>;
                })()}
              </div>
            </div>

            {selectedEvent.amount && (
              <div>
                <p className="text-muted-foreground text-sm mb-1">Amount</p>
                <p className="text-lg font-semibold">₹{selectedEvent.amount.toLocaleString('en-IN')}</p>
              </div>
            )}

            {/* Reminders Section */}
            {/* ⭐ Use shared mapper for consistency */}
            <ReminderDisplay 
              entityType={calendarEntityTypeToReminderEntityType(selectedEvent.entityType)}
              entityId={entityIdForApi ?? selectedEvent.id}
              isRecurring={!!selectedEvent.recurrenceData}
              recurrenceData={selectedEvent.recurrenceData}
              dueDate={selectedEvent.dueDate}
              occurrenceDate={selectedEvent.recurrenceData ? format(new Date(selectedEvent.dueDate), 'yyyy-MM-dd') : undefined}
              compactOccurrences
              targetDate={selectedEvent.dueDate ? new Date(selectedEvent.dueDate) : undefined}
              source="calendar"
              variant="embedded"
            />

            <div className="flex items-center justify-end gap-2 pt-4">
              <div className="flex flex-col items-end">
                <Button
                  size="sm"
                  onClick={() => setCompletionDialogOpen(true)}
                  disabled={
                    completeOccurrenceMutation.isPending ||
                    selectedOccurrenceCompleted ||
                    !isDueTodayOrPast(isRecurring ? occurrenceTaskDateUtcIso : selectedEvent.dueDate)
                  }
                  data-testid="calendar-mark-complete"
                  title={
                    !isDueTodayOrPast(isRecurring ? occurrenceTaskDateUtcIso : selectedEvent.dueDate)
                      ? "Cannot complete before due date"
                      : undefined
                  }
                >
                  {completeOccurrenceMutation.isPending ? "Saving..." : "Mark Complete"}
                </Button>
                {!isDueTodayOrPast(isRecurring ? occurrenceTaskDateUtcIso : selectedEvent.dueDate) && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Available on {formatDueDateMessage(isRecurring ? occurrenceTaskDateUtcIso : selectedEvent.dueDate)}
                  </p>
                )}
              </div>
            </div>

            <TaskCompletionDialog
              open={completionDialogOpen}
              onOpenChange={setCompletionDialogOpen}
              entityType={(() => {
                const et = resolveEntityTypeForApi(selectedEvent.entityType);
                return et === "calendar_event" ? "task_action_item" : et;
              })()}
              entityId={
                resolveEntityTypeForApi(selectedEvent.entityType) === "calendar_event"
                  ? selectedEvent.id
                  : entityIdForApi ?? selectedEvent.id
              }
              entityTitle={selectedEvent.title}
              occurrenceKey={selectedOccurrenceKey ?? undefined}
              confirmDisabled={
                selectedOccurrenceCompleted ||
                !isDueTodayOrPast(isRecurring ? occurrenceTaskDateUtcIso : selectedEvent.dueDate)
              }
              onCompleteWithNotes={(notes) => completeOccurrenceMutation.mutateAsync(notes)}
              onSuccess={() => {
                if (isRecurring) {
                  occurrenceStatusesQuery.refetch();
                } else {
                  occurrenceStatusQuery.refetch();
                }
              }}
            />
          </div>
        </DialogContent>
      </Dialog>
      )}

      {/* Delete Confirmation Dialog - Type to Confirm */}
      <ConfirmDeleteByNameDialog
        open={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        entityLabel="Event"
        entityName={selectedEvent?.title ?? ""}
        onConfirm={async () => {
          if (!selectedEvent) return;
          await deleteMutation.mutateAsync(selectedEvent);
          setShowDeleteConfirm(false);
        }}
      />

      {/* ==========================================================
          PAGE 2: Task Ledger (Portrait)
          Hidden on screen, visible only in print
          ========================================================== */}
      <div className="calendar-print-page" aria-hidden="true">
        <div style={{ fontFamily: 'Arial, sans-serif', background: '#ffffff', width: '100%' }}>
          <h1 style={{ fontSize: '14pt', fontWeight: '500', margin: '0', padding: '8pt 3mm', textAlign: 'center', borderBottom: '2pt solid #000', background: '#fff' }}>
            Task Ledger - {format(currentDate, 'MMMM yyyy')}
          </h1>
          
          <div style={{ marginTop: '0', padding: '8pt 3mm' }}>
            <h2 style={{ fontSize: '12pt', fontWeight: '500', marginBottom: '10pt', color: '#333' }}>
              Monthly Overview
            </h2>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '12pt', marginBottom: '15pt' }}>
              <div style={{ padding: '10pt', textAlign: 'center' }}>
                <div style={{ fontSize: '9pt', color: '#6c757d', marginBottom: '6pt' }}>Total Events</div>
                <div style={{ fontSize: '18pt', fontWeight: '500', color: '#0066cc' }}>
                  {filteredItems.length}
                </div>
              </div>
              
              <div style={{ padding: '10pt', textAlign: 'center' }}>
                <div style={{ fontSize: '9pt', color: '#6c757d', marginBottom: '6pt' }}>Completed</div>
                <div style={{ fontSize: '18pt', fontWeight: '500', color: '#16a34a' }}>
                  {filteredItems.filter(item => item.status === 'completed').length}
                </div>
              </div>
              
              <div style={{ padding: '10pt', textAlign: 'center' }}>
                <div style={{ fontSize: '9pt', color: '#6c757d', marginBottom: '6pt' }}>Overdue</div>
                <div style={{ fontSize: '18pt', fontWeight: '500', color: '#dc2626' }}>
                  {filteredItems.filter(item => 
                    item.status !== 'completed' && isBefore(new Date(item.dueDate), new Date())
                  ).length}
                </div>
              </div>
              
              <div style={{ padding: '10pt', textAlign: 'center' }}>
                <div style={{ fontSize: '9pt', color: '#6c757d', marginBottom: '6pt' }}>Pending</div>
                <div style={{ fontSize: '18pt', fontWeight: '500', color: '#2563eb' }}>
                  {filteredItems.filter(item => 
                    item.status !== 'completed' && 
                    (isAfter(new Date(item.dueDate), new Date()) || isSameDay(new Date(item.dueDate), new Date()))
                  ).length}
                </div>
              </div>
            </div>

            {/* Overdue Section */}
            {filteredItems.filter(item => item.status !== 'completed' && isBefore(new Date(item.dueDate), new Date())).length > 0 && (
              <div style={{ marginBottom: '12pt' }}>
                <h3 style={{ fontSize: '12pt', fontWeight: '600', marginBottom: '8pt', color: '#dc2626', display: 'flex', alignItems: 'center', gap: '6pt' }}>
                  <span style={{ fontSize: '10pt' }}>⚠</span> Overdue ({filteredItems.filter(item => item.status !== 'completed' && isBefore(new Date(item.dueDate), new Date())).length})
                </h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8pt' }}>
                  {filteredItems
                    .filter(item => item.status !== 'completed' && isBefore(new Date(item.dueDate), new Date()))
                    .map(item => (
                      <div key={item.id} style={{ padding: '8pt', background: '#fff5f5', border: '1pt solid #fecaca', borderRadius: '4pt', borderLeft: '3pt solid #dc2626', minWidth: '180px' }}>
                        <div style={{ fontSize: '9pt', fontWeight: '600', color: '#000', marginBottom: '3pt' }}>
                          {item.title}
                          {item.isRecurringOccurrence && <span style={{ fontSize: '8pt', opacity: 0.6, marginLeft: '4pt' }}>🔄</span>}
                        </div>
                        <div style={{ fontSize: '8pt', color: '#6c757d', display: 'flex', gap: '8pt', flexWrap: 'wrap' }}>
                          <span style={{ textTransform: 'uppercase', fontSize: '7pt', fontWeight: '500' }}>{item.entityType}</span>
                          <span>{format(new Date(item.dueDate), 'MMM d, yyyy')}</span>
                          <span style={{ color: '#dc2626', fontWeight: '500' }}>Overdue</span>
                        </div>
                      </div>
                    ))
                  }
                </div>
              </div>
            )}

            {/* Pending Section */}
            {filteredItems.filter(item => item.status !== 'completed' && (isAfter(new Date(item.dueDate), new Date()) || isSameDay(new Date(item.dueDate), new Date()))).length > 0 && (
              <div style={{ marginBottom: '12pt' }}>
                <h3 style={{ fontSize: '12pt', fontWeight: '600', marginBottom: '8pt', color: '#2563eb', display: 'flex', alignItems: 'center', gap: '6pt' }}>
                  <span style={{ fontSize: '10pt' }}>📋</span> Pending ({filteredItems.filter(item => item.status !== 'completed' && (isAfter(new Date(item.dueDate), new Date()) || isSameDay(new Date(item.dueDate), new Date()))).length})
                </h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8pt' }}>
                  {filteredItems
                    .filter(item => item.status !== 'completed' && (isAfter(new Date(item.dueDate), new Date()) || isSameDay(new Date(item.dueDate), new Date())))
                    .map(item => (
                      <div key={item.id} style={{ padding: '8pt', background: '#eff6ff', border: '1pt solid #dbeafe', borderRadius: '4pt', borderLeft: '3pt solid #2563eb', minWidth: '180px' }}>
                        <div style={{ fontSize: '9pt', fontWeight: '600', color: '#000', marginBottom: '3pt' }}>
                          {item.title}
                          {item.isRecurringOccurrence && <span style={{ fontSize: '8pt', opacity: 0.6, marginLeft: '4pt' }}>🔄</span>}
                        </div>
                        <div style={{ fontSize: '8pt', color: '#6c757d', display: 'flex', gap: '8pt', flexWrap: 'wrap' }}>
                          <span style={{ textTransform: 'uppercase', fontSize: '7pt', fontWeight: '500' }}>{item.entityType}</span>
                          <span>{format(new Date(item.dueDate), 'MMM d, yyyy')}</span>
                          <span style={{ color: '#2563eb', fontWeight: '500' }}>Pending</span>
                        </div>
                      </div>
                    ))
                  }
                </div>
              </div>
            )}

            {/* Completed Section */}
            {filteredItems.filter(item => item.status === 'completed').length > 0 && (
              <div style={{ marginBottom: '12pt' }}>
                <h3 style={{ fontSize: '12pt', fontWeight: '600', marginBottom: '8pt', color: '#16a34a', display: 'flex', alignItems: 'center', gap: '6pt' }}>
                  <span style={{ fontSize: '10pt' }}>✓</span> Completed ({filteredItems.filter(item => item.status === 'completed').length})
                </h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8pt' }}>
                  {filteredItems
                    .filter(item => item.status === 'completed')
                    .map(item => (
                      <div key={item.id} style={{ padding: '8pt', background: '#f0fdf4', border: '1pt solid #bbf7d0', borderRadius: '4pt', borderLeft: '3pt solid #16a34a', minWidth: '180px' }}>
                        <div style={{ fontSize: '9pt', fontWeight: '600', color: '#000', marginBottom: '3pt' }}>
                          {item.title}
                          {item.isRecurringOccurrence && <span style={{ fontSize: '8pt', opacity: 0.6, marginLeft: '4pt' }}>🔄</span>}
                        </div>
                        <div style={{ fontSize: '8pt', color: '#6c757d', display: 'flex', gap: '8pt', flexWrap: 'wrap' }}>
                          <span style={{ textTransform: 'uppercase', fontSize: '7pt', fontWeight: '500' }}>{item.entityType}</span>
                          <span>{format(new Date(item.dueDate), 'MMM d, yyyy')}</span>
                          <span style={{ color: '#16a34a', fontWeight: '500' }}>Completed</span>
                        </div>
                      </div>
                    ))
                  }
                </div>
              </div>
            )}

            {/* Upcoming (Next Month) Section */}
            {(() => {
              const nextMonth = addMonths(currentDate, 1);
              const nextMonthStart = startOfMonth(nextMonth);
              const nextMonthEnd = endOfMonth(nextMonth);
              const upcomingItems = filteredItems.filter(item => {
                const itemDate = new Date(item.dueDate);
                return itemDate >= nextMonthStart && itemDate <= nextMonthEnd;
              });
              
              return upcomingItems.length > 0 && (
                <div style={{ marginBottom: '12pt' }}>
                  <h3 style={{ fontSize: '12pt', fontWeight: '600', marginBottom: '8pt', color: '#0891b2', display: 'flex', alignItems: 'center', gap: '6pt' }}>
                    <span style={{ fontSize: '10pt' }}>📅</span> Upcoming (Next Month) ({upcomingItems.length})
                  </h3>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8pt' }}>
                    {upcomingItems.map(item => (
                      <div key={item.id} style={{ padding: '8pt', background: '#ecfeff', border: '1pt solid #a5f3fc', borderRadius: '4pt', borderLeft: '3pt solid #0891b2', minWidth: '180px' }}>
                        <div style={{ fontSize: '9pt', fontWeight: '600', color: '#000', marginBottom: '3pt' }}>
                          {item.title}
                          {item.isRecurringOccurrence && <span style={{ fontSize: '8pt', opacity: 0.6, marginLeft: '4pt' }}>🔄</span>}
                        </div>
                        <div style={{ fontSize: '8pt', color: '#6c757d', display: 'flex', gap: '8pt', flexWrap: 'wrap' }}>
                          <span style={{ textTransform: 'uppercase', fontSize: '7pt', fontWeight: '500' }}>{item.entityType}</span>
                          <span>{format(new Date(item.dueDate), 'MMM d, yyyy')}</span>
                          <span style={{ color: '#0891b2', fontWeight: '500' }}>{Math.ceil((new Date(item.dueDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))}d away</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Signature Section */}
            <div style={{ marginTop: '25pt', marginBottom: '15pt', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', paddingTop: '15pt', borderTop: '1pt solid #e5e7eb' }}>
              <div style={{ textAlign: 'center', width: '45%' }}>
                <div style={{ borderBottom: '1pt solid #000', marginBottom: '5pt', height: '40pt' }}></div>
                <div style={{ fontSize: '9pt', fontWeight: '500', color: '#333' }}>Operation Officer</div>
              </div>
              <div style={{ textAlign: 'center', width: '45%' }}>
                <div style={{ borderBottom: '1pt solid #000', marginBottom: '5pt', height: '40pt' }}></div>
                <div style={{ fontSize: '9pt', fontWeight: '500', color: '#333' }}>Managing Director</div>
              </div>
            </div>

            <div style={{ marginTop: '15pt', marginLeft: '3mm', marginRight: '3mm', textAlign: 'center', fontSize: '8pt', color: '#9ca3af', borderTop: '1pt solid #e5e7eb', paddingTop: '10pt' }}>
              <p style={{ margin: 0 }}>Tax Tracker Calendar Report - Generated on {format(new Date(), 'MMM d, yyyy • h:mm a')}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Event Modal */}
      <QuickEventModal
        isOpen={showQuickEventModal}
        onClose={() => setShowQuickEventModal(false)}
        initialDate={quickEventDate}
      />
    </>
  );
}