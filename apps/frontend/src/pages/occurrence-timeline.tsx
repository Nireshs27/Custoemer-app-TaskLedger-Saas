import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Clock, Calendar as CalendarIcon, Target, ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { formatUtcToIstDisplay } from "@/lib/datetime";
import { apiRequest } from "@/lib/queryClient";
import { findNearestOccurrence } from "@/lib/occurrence-scroll";
import type { 
  DbOccurrencesResponse, 
  DbGroupedOccurrence,
  ReminderOccurrence,
  RecipientDeliveryStatus,
  AggregateStatus,
} from "@/components/reminder-display";

// Re-use the occurrence transformation logic
function transformDbOccurrenceToReminderOccurrence(
  dbOcc: DbGroupedOccurrence,
  index: number
): ReminderOccurrence {
  const recipientStatuses: RecipientDeliveryStatus[] = (dbOcc.recipients || []).map(r => ({
    recipientEmail: r.recipient || '',
    status: (r.reminderStatus as RecipientDeliveryStatus['status']) || 'pending',
    attemptedAt: r.lastAttemptAt,
    errorMessage: r.lastError,
    messageId: r.messageId,
  }));

  const statuses = recipientStatuses.map(r => r.status);
  let aggregateStatus: AggregateStatus = 'pending';
  if (statuses.every(s => s === 'sent')) {
    aggregateStatus = 'sent';
  } else if (statuses.some(s => s === 'failed')) {
    aggregateStatus = 'failed';
  } else if (statuses.some(s => s === 'expired')) {
    aggregateStatus = 'expired';
  } else if (statuses.some(s => s === 'sending')) {
    aggregateStatus = 'sending';
  } else if (statuses.some(s => s === 'sent')) {
    aggregateStatus = 'partial';
  }

  return {
    id: dbOcc.occurrenceKey,
    scheduleType: 'one_time',
    reminderDate: dbOcc.earliestReminderAtUtc || '',
    reminderDaysBefore: 0,
    scheduleStatus: 'pending',
    isActive: true,
    recipientEmail: [],
    taskTitle: dbOcc.taskTitle,
    taskCategory: dbOcc.taskCategory,
    occurrenceIndex: index,
    calculatedReminderDateUtc: dbOcc.earliestReminderAtUtc || dbOcc.occurrenceTaskUtc,
    calculatedTaskDateUtc: dbOcc.occurrenceTaskUtc,
    recipientStatuses,
    aggregateStatus,
    taskStatus: dbOcc.taskStatus,
    completedAt: dbOcc.completedAt,
  } as ReminderOccurrence;
}

// Helper to get status metadata
function getStatusMeta(occurrence: ReminderOccurrence) {
  const completionStatus = occurrence.taskStatus === 'completed' || Boolean(occurrence.completedAt);
  
  if (completionStatus) {
    return { label: "Completed", dotClass: "bg-emerald-500", borderClass: "border-emerald-500", textClass: "text-emerald-600", badgeClass: "bg-emerald-100 text-emerald-700" };
  }
  if (occurrence.aggregateStatus === "sent") {
    return { label: "Sent", dotClass: "bg-emerald-500", borderClass: "border-emerald-500", textClass: "text-emerald-600", badgeClass: "bg-emerald-100 text-emerald-700" };
  }
  if (occurrence.aggregateStatus === "failed") {
    return { label: "Failed", dotClass: "bg-rose-500", borderClass: "border-rose-500", textClass: "text-rose-600", badgeClass: "bg-rose-100 text-rose-700" };
  }
  if (occurrence.aggregateStatus === "expired") {
    return { label: "Expired", dotClass: "bg-slate-400", borderClass: "border-slate-400", textClass: "text-slate-600", badgeClass: "bg-slate-100 text-slate-700" };
  }
  if (occurrence.aggregateStatus === "sending") {
    return { label: "Sending", dotClass: "bg-sky-500", borderClass: "border-sky-500", textClass: "text-sky-600", badgeClass: "bg-sky-100 text-sky-700" };
  }
  if (occurrence.aggregateStatus === "partial") {
    return { label: "Partial", dotClass: "bg-amber-500", borderClass: "border-amber-500", textClass: "text-amber-600", badgeClass: "bg-amber-100 text-amber-700" };
  }
  return { label: "Pending", dotClass: "bg-primary", borderClass: "border-primary", textClass: "text-primary", badgeClass: "bg-primary/10 text-primary" };
}

/**
 * Portal-based Occurrence Details Overlay
 * Renders to document.body so it's never clipped by overflow containers
 */
function OccurrenceDetailsOverlay({
  occurrence,
  anchorRect,
  onClose,
}: {
  occurrence: ReminderOccurrence;
  anchorRect: DOMRect;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  
  const statusMeta = getStatusMeta(occurrence);
  const completionStatus = occurrence.taskStatus === 'completed' || Boolean(occurrence.completedAt);
  const recipientStatuses = occurrence.recipientStatuses ?? [];
  const formattedTaskDate = formatUtcToIstDisplay(occurrence.calculatedTaskDateUtc);
  const formattedReminderDate = formatUtcToIstDisplay(occurrence.calculatedReminderDateUtc);

  // Calculate position after panel renders
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    const panelRect = panel.getBoundingClientRect();
    const viewportPadding = 12;
    const anchorGap = 12;
    
    let top: number;
    let left: number;

    // Prefer below anchor
    const spaceBelow = window.innerHeight - anchorRect.bottom - anchorGap - viewportPadding;
    const spaceAbove = anchorRect.top - anchorGap - viewportPadding;
    
    if (spaceBelow >= panelRect.height || spaceBelow >= spaceAbove) {
      // Position below
      top = anchorRect.bottom + anchorGap;
    } else {
      // Position above
      top = anchorRect.top - panelRect.height - anchorGap;
    }

    // Center horizontally on anchor, then clamp to viewport
    left = anchorRect.left + (anchorRect.width / 2) - (panelRect.width / 2);
    
    // Clamp left edge
    if (left < viewportPadding) {
      left = viewportPadding;
    }
    // Clamp right edge
    if (left + panelRect.width > window.innerWidth - viewportPadding) {
      left = window.innerWidth - panelRect.width - viewportPadding;
    }

    // Clamp top edge (shouldn't go off screen)
    if (top < viewportPadding) {
      top = viewportPadding;
    }
    // Clamp bottom edge
    if (top + panelRect.height > window.innerHeight - viewportPadding) {
      top = window.innerHeight - panelRect.height - viewportPadding;
    }

    setPosition({ top, left });
  }, [anchorRect]);

  // Handle ESC key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return createPortal(
    <AnimatePresence>
      <div className="fixed inset-0 z-[9999]">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/20"
          onClick={onClose}
        />
        
        {/* Panel */}
        <motion.div
          ref={panelRef}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.15 }}
          className="fixed w-80 max-w-[calc(100vw-24px)] p-4 rounded-2xl bg-card border shadow-xl"
          style={{ top: position.top, left: position.left }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between">
              <Badge className={cn("rounded-full text-[10px] font-bold uppercase", statusMeta.badgeClass)}>
                {completionStatus ? "COMPLETED" : statusMeta.label.toUpperCase()}
              </Badge>
              <button 
                onClick={onClose}
                className="p-1 rounded-full hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            {/* Occurrence number */}
            <div className="text-lg font-bold text-foreground">
              Occurrence #{occurrence.occurrenceIndex + 1}
            </div>
            
            {/* Dates */}
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <CalendarIcon className="w-4 h-4 text-orange-500 flex-shrink-0" />
                <span><strong>Task:</strong> {formattedTaskDate}</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-blue-500 flex-shrink-0" />
                <span><strong>Reminder:</strong> {formattedReminderDate}</span>
              </div>
            </div>
            
            {/* Recipients */}
            {recipientStatuses.length > 0 && (
              <div className="pt-3 border-t space-y-2">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Recipients ({recipientStatuses.length})
                </span>
                <div className="space-y-1.5 max-h-32 overflow-y-auto">
                  {recipientStatuses.map((r, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <span className={cn(
                        "w-2 h-2 rounded-full flex-shrink-0",
                        r.status === "sent" ? "bg-emerald-500" :
                        r.status === "failed" ? "bg-rose-500" :
                        r.status === "expired" ? "bg-slate-400" :
                        r.status === "sending" ? "bg-sky-500" :
                        "bg-slate-300"
                      )} />
                      <span className="truncate flex-1">{r.recipientEmail}</span>
                      <span className={cn(
                        "text-[10px] uppercase font-medium",
                        r.status === "sent" ? "text-emerald-600" :
                        r.status === "failed" ? "text-rose-600" :
                        "text-muted-foreground"
                      )}>
                        {r.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>,
    document.body
  );
}

/**
 * Timeline Node Component - Simplified without local popover
 */
function TimelineNode({
  occurrence,
  showOccurrenceNumber = false,
  isHighlighted = false,
  index = 0,
  position = 'above',
  onSelect,
}: {
  occurrence: ReminderOccurrence;
  showOccurrenceNumber?: boolean;
  isHighlighted?: boolean;
  index?: number;
  position?: 'above' | 'below';
  onSelect: (occurrence: ReminderOccurrence, anchorEl: HTMLElement) => void;
}) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const statusMeta = getStatusMeta(occurrence);
  const completionStatus = occurrence.taskStatus === 'completed' || Boolean(occurrence.completedAt);

  const recipientStatuses = occurrence.recipientStatuses ?? [];
  const sentCount = recipientStatuses.filter(r => r.status === "sent").length;
  const pendingCount = recipientStatuses.filter(r => r.status === "pending").length;
  const failedCount = recipientStatuses.filter(r => r.status === "failed" || r.status === "expired").length;
  
  const formattedReminderDate = formatUtcToIstDisplay(occurrence.calculatedReminderDateUtc);
  const taskDate = new Date(occurrence.calculatedTaskDateUtc);
  const shortDate = format(taskDate, "MMM d");

  const handleClick = () => {
    if (nodeRef.current) {
      onSelect(occurrence, nodeRef.current);
    }
  };

  return (
    <div
      ref={nodeRef}
      className={cn(
        "relative flex flex-col items-center flex-shrink-0",
        "w-[140px] sm:w-[160px]",
        position === 'above' ? "flex-col" : "flex-col-reverse"
      )}
      style={{ scrollSnapAlign: 'center' }}
      data-occurrence-id={occurrence.id}
    >
      {/* Content card */}
      <motion.div
        initial={{ opacity: 0, y: position === 'above' ? 10 : -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: index * 0.05 }}
        whileHover={{ scale: 1.03 }}
        onClick={handleClick}
        className="cursor-pointer text-center px-2 py-1 select-none"
      >
        {showOccurrenceNumber && (
          <span className={cn("block text-base font-bold", statusMeta.textClass)}>
            #{occurrence.occurrenceIndex + 1}
          </span>
        )}
        
        <p className="text-xs text-muted-foreground leading-snug">
          {completionStatus ? (
            <span className="text-emerald-600 font-medium">Completed</span>
          ) : occurrence.aggregateStatus === "sent" ? (
            <span className="text-emerald-600 font-medium">
              Sent to {sentCount} recipient{sentCount !== 1 ? 's' : ''}
            </span>
          ) : occurrence.aggregateStatus === "failed" ? (
            <span className="text-rose-600 font-medium">
              Failed ({failedCount})
            </span>
          ) : (
            <span>{pendingCount > 0 ? `Pending (${pendingCount})` : 'Scheduled'}</span>
          )}
        </p>
        
        <p className="text-[10px] text-muted-foreground/60">
          {formattedReminderDate?.split(',')[0] || '—'}
        </p>
      </motion.div>
      
      {/* Connector line */}
      <div className="w-px h-6 bg-border" />
      
      {/* Timeline node/dot */}
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: index * 0.05, type: "spring", stiffness: 300 }}
        onClick={handleClick}
        className={cn(
          "relative w-6 h-6 rounded-full border-[3px] bg-card cursor-pointer",
          "shadow-sm hover:scale-110 transition-transform duration-200",
          statusMeta.borderClass,
          isHighlighted && "ring-4 ring-primary/30 scale-110"
        )}
      >
        <div className={cn("absolute inset-1 rounded-full", statusMeta.dotClass)} />
      </motion.div>
      
      {/* Date label */}
      <motion.span
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: index * 0.05 + 0.1 }}
        className={cn("text-base font-bold mt-1", statusMeta.textClass)}
      >
        {shortDate}
      </motion.span>
    </div>
  );
}

export default function OccurrenceTimelinePage() {
  const [, navigate] = useLocation();
  const [matched, params] = useRoute("/occurrences/:entityType/:entityId/timeline");
  
  const entityType = params?.entityType as string;
  const entityId = params?.entityId as string;
  
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [highlightedOccurrenceId, setHighlightedOccurrenceId] = useState<string | null>(null);
  
  // Selected occurrence for details overlay
  const [selectedOccurrence, setSelectedOccurrence] = useState<ReminderOccurrence | null>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  
  // Scroll button disabled states
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  
  // Fetch occurrences
  const { data: occurrencesData, isLoading } = useQuery<DbOccurrencesResponse>({
    queryKey: [`/api/task-occurrences/entity/${entityType}/${entityId}`],
    queryFn: async () => {
      return apiRequest<DbOccurrencesResponse>(
        'GET',
        `/api/task-occurrences/entity/${entityType}/${entityId}`
      );
    },
    enabled: !!entityId && !!entityType,
    refetchOnMount: true,
  });

  // Transform DB occurrences
  const allOccurrences = useMemo(() => {
    if (!occurrencesData?.items) return [];
    return occurrencesData.items.map((item, idx) => 
      transformDbOccurrenceToReminderOccurrence(item, idx)
    );
  }, [occurrencesData]);

  const isRecurring = allOccurrences.length > 1;
  const today = new Date();

  // Find nearest occurrence
  const nearestOccurrence = useMemo(() => {
    if (allOccurrences.length === 0) return null;
    return findNearestOccurrence(
      allOccurrences.map(occ => ({
        id: occ.id,
        calculatedTaskDateUtc: occ.calculatedTaskDateUtc,
        occurrenceIndex: occ.occurrenceIndex,
      })),
      today
    );
  }, [allOccurrences]);

  // Handle node selection
  const handleNodeSelect = useCallback((occurrence: ReminderOccurrence, anchorEl: HTMLElement) => {
    setSelectedOccurrence(occurrence);
    setAnchorRect(anchorEl.getBoundingClientRect());
  }, []);

  // Close overlay
  const handleCloseOverlay = useCallback(() => {
    setSelectedOccurrence(null);
    setAnchorRect(null);
  }, []);

  // Update scroll button states with RAF throttle
  const rafRef = useRef<number | null>(null);
  const updateScrollButtons = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const container = scrollContainerRef.current;
      if (!container) return;
      
      const { scrollLeft, scrollWidth, clientWidth } = container;
      const epsilon = 2;
      
      setCanScrollLeft(scrollLeft > epsilon);
      setCanScrollRight(scrollLeft + clientWidth < scrollWidth - epsilon);
    });
  }, []);

  // Setup wheel handler with passive: false and scroll/resize listeners
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    // Initial update
    updateScrollButtons();

    // Wheel handler: convert vertical wheel to horizontal scroll
    const handleWheel = (e: WheelEvent) => {
      // Only handle if vertical scroll intent is greater than horizontal
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        const { scrollLeft, scrollWidth, clientWidth } = container;
        const maxScrollLeft = scrollWidth - clientWidth;
        
        // Check if we can scroll in the intended direction
        const canScrollInDirection = 
          (e.deltaY > 0 && scrollLeft < maxScrollLeft - 1) || 
          (e.deltaY < 0 && scrollLeft > 1);
        
        if (canScrollInDirection) {
          e.preventDefault();
          container.scrollLeft += e.deltaY;
        }
      }
    };

    // Attach with passive: false to allow preventDefault
    container.addEventListener('wheel', handleWheel, { passive: false });
    container.addEventListener('scroll', updateScrollButtons, { passive: true });
    window.addEventListener('resize', updateScrollButtons);

    return () => {
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('scroll', updateScrollButtons);
      window.removeEventListener('resize', updateScrollButtons);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [updateScrollButtons, allOccurrences]);

  // Scroll navigation functions
  const scrollLeftFn = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container || !canScrollLeft) return;
    container.scrollBy({ left: -300, behavior: 'smooth' });
  }, [canScrollLeft]);

  const scrollRightFn = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container || !canScrollRight) return;
    container.scrollBy({ left: 300, behavior: 'smooth' });
  }, [canScrollRight]);

  // Jump to today
  const jumpToToday = useCallback(() => {
    if (!nearestOccurrence || !scrollContainerRef.current) return;
    
    setHighlightedOccurrenceId(nearestOccurrence.id);
    
    const container = scrollContainerRef.current;
    const targetElement = container.querySelector(`[data-occurrence-id="${nearestOccurrence.id}"]`);
    
    if (targetElement) {
      targetElement.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
    
    setTimeout(() => updateScrollButtons(), 500);
    setTimeout(() => setHighlightedOccurrenceId(null), 3000);
  }, [nearestOccurrence, updateScrollButtons]);

  // Helper to get fallback path based on entity type
  const getOccurrenceBackFallbackPath = (t?: string): string => {
    switch (t) {
      case "tax_legal_item":
        return "/tax-legal-compliances";
      case "vehicle_item":
        return "/vehicles";
      case "asset_item":
        return "/assets";
      case "task_action":
        return "/task-actions";
      case "property":
        return "/properties";
      default:
        return "/";
    }
  };

  // Go back - handle case where there's no history (opened in new tab)
  const handleBack = () => {
    // NEVER use navigate(-1) with wouter — it becomes "/-1" and causes 404.
    if (typeof window !== "undefined" && window.history && window.history.length > 1) {
      window.history.back();
      return;
    }
    navigate(getOccurrenceBackFallbackPath(entityType));
  };

  if (!matched) {
    return null;
  }

  return (
    <div className="flex flex-col min-h-[calc(100vh-2rem)] gap-4">
      {/* Header Card - Fixed height */}
      <Card className="shadow-lg flex-shrink-0">
        <CardContent className="p-4 sm:p-6">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3 sm:gap-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleBack}
                className="gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                <span className="hidden sm:inline">Back</span>
              </Button>
              <div>
                <h1 className="text-lg sm:text-xl font-bold">
                  {isLoading ? 'Loading...' : allOccurrences[0]?.taskTitle || 'Task Occurrences'}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {isLoading ? '' : `${allOccurrences.length} occurrence${allOccurrences.length !== 1 ? 's' : ''}`}
                </p>
              </div>
            </div>
            
            {isRecurring && (
              <Button
                variant="outline"
                size="sm"
                onClick={jumpToToday}
                className="rounded-full"
              >
                <Target className="w-4 h-4 sm:mr-2" />
                <span className="hidden sm:inline">Jump to Today</span>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Timeline Card - Fills remaining space */}
      <Card className="shadow-lg flex-1 flex flex-col overflow-hidden">
        <CardContent className="p-0 flex-1 flex flex-col">
          {isLoading ? (
            <div className="flex items-center justify-center flex-1">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : allOccurrences.length === 0 ? (
            <div className="flex items-center justify-center flex-1 text-muted-foreground">
              No occurrences found
            </div>
          ) : (
            <div className="flex flex-col flex-1">
              {/* Year header */}
              <div className="flex items-center justify-center gap-4 py-4 sm:py-6 border-b bg-muted/30 flex-shrink-0">
                <span className="text-2xl sm:text-3xl font-bold text-primary">
                  {new Date(allOccurrences[0]?.calculatedTaskDateUtc || today).getFullYear()}
                </span>
                <Badge variant="secondary" className="text-sm">
                  {allOccurrences.length} occurrence{allOccurrences.length !== 1 ? 's' : ''}
                </Badge>
              </div>
              
              {/* Timeline zone - flex-1 to fill remaining height */}
              <div className="relative flex-1 min-h-[300px]">
                {/* Left arrow */}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={scrollLeftFn}
                  disabled={!canScrollLeft}
                  aria-disabled={!canScrollLeft}
                  className={cn(
                    "absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 z-20",
                    "h-9 w-9 sm:h-10 sm:w-10 rounded-full bg-card/90 backdrop-blur-sm shadow-md border",
                    "transition-opacity duration-200",
                    canScrollLeft 
                      ? "hover:bg-muted cursor-pointer" 
                      : "opacity-40 cursor-not-allowed"
                  )}
                >
                  <ChevronLeft className="h-5 w-5" />
                </Button>
                
                {/* Timeline scroll viewport */}
                <div 
                  ref={scrollContainerRef}
                  className="absolute inset-0 overflow-x-auto overflow-y-hidden"
                  style={{ 
                    scrollBehavior: 'smooth',
                    scrollSnapType: 'x mandatory',
                    scrollPaddingLeft: '56px',
                    scrollPaddingRight: '56px',
                    scrollbarWidth: 'none',
                    msOverflowStyle: 'none',
                  }}
                >
                  {/* Hide scrollbar for webkit */}
                  <style>{`
                    div::-webkit-scrollbar { display: none; }
                  `}</style>
                  
                  {/* Inner content - centers baseline vertically */}
                  <div 
                    className="relative flex items-center min-w-max h-full"
                    style={{ 
                      paddingLeft: '56px', 
                      paddingRight: '56px',
                    }}
                  >
                    {/* Horizontal timeline baseline - centered */}
                    <div 
                      className="absolute left-0 right-0 h-0.5 bg-border pointer-events-none"
                      style={{ top: '50%', transform: 'translateY(-50%)' }}
                    />
                    
                    {/* Timeline nodes container */}
                    <div className="relative flex items-center gap-4 sm:gap-6 md:gap-8">
                      {allOccurrences.map((occurrence, occIdx) => (
                        <TimelineNode
                          key={occurrence.id}
                          occurrence={occurrence}
                          showOccurrenceNumber={isRecurring}
                          isHighlighted={highlightedOccurrenceId === occurrence.id}
                          index={occIdx}
                          position={occIdx % 2 === 0 ? 'above' : 'below'}
                          onSelect={handleNodeSelect}
                        />
                      ))}
                    </div>
                  </div>
                </div>
                
                {/* Right arrow */}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={scrollRightFn}
                  disabled={!canScrollRight}
                  aria-disabled={!canScrollRight}
                  className={cn(
                    "absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 z-20",
                    "h-9 w-9 sm:h-10 sm:w-10 rounded-full bg-card/90 backdrop-blur-sm shadow-md border",
                    "transition-opacity duration-200",
                    canScrollRight 
                      ? "hover:bg-muted cursor-pointer" 
                      : "opacity-40 cursor-not-allowed"
                  )}
                >
                  <ChevronRight className="h-5 w-5" />
                </Button>
              </div>
              
              {/* Scroll hint */}
              <div className="text-center py-3 sm:py-4 border-t bg-muted/30 flex-shrink-0">
                <span className="text-xs text-muted-foreground">
                  Scroll with mouse wheel or use arrows • Click any occurrence for details
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Portal-based Details Overlay */}
      {selectedOccurrence && anchorRect && (
        <OccurrenceDetailsOverlay
          occurrence={selectedOccurrence}
          anchorRect={anchorRect}
          onClose={handleCloseOverlay}
        />
      )}
    </div>
  );
}
