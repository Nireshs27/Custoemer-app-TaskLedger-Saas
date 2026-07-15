import { QueryClient } from "@tanstack/react-query";

/**
 * Reusable Optimistic Update Utilities
 * Following DRY principles - use across all create/update/delete operations
 */

export interface OptimisticCalendarItem {
  id: string;
  title: string;
  dueDate: Date;
  category: string;
  status: string;
  entityType: 'tax' | 'vehicle' | 'asset' | 'event' | 'task_action_item' | 'tax_legal_item';
  amount?: number;
  vehicleId?: string | null;
  vehicleName?: string | null;
  isRecurring?: boolean;
  recurrenceData?: any;
}

/**
 * Cancel all calendar queries to prevent race conditions
 * Handles both formats: ["calendar-items", ...] and ["/api/calendar/items?..."]
 */
export const cancelCalendarQueries = async (queryClient: QueryClient) => {
  await queryClient.cancelQueries({ 
    predicate: (query) => 
      (typeof query.queryKey[0] === 'string' && query.queryKey[0] === 'calendar-items') ||
      (typeof query.queryKey[0] === 'string' && query.queryKey[0].startsWith('/api/calendar/items'))
  });
};

/**
 * Get snapshot of all calendar data for rollback
 * Handles both formats: ["calendar-items", ...] and ["/api/calendar/items?..."]
 */
export const snapshotCalendarQueries = (queryClient: QueryClient) => {
  return queryClient.getQueriesData({ 
    predicate: (query) => 
      (typeof query.queryKey[0] === 'string' && query.queryKey[0] === 'calendar-items') ||
      (typeof query.queryKey[0] === 'string' && query.queryKey[0].startsWith('/api/calendar/items'))
  });
};

/**
 * Invalidate all calendar queries to sync with server
 * Handles both formats: ["calendar-items", ...] and ["/api/calendar/items?..."]
 */
export const invalidateCalendarQueries = (queryClient: QueryClient) => {
  queryClient.invalidateQueries({ 
    predicate: (query) => 
      (typeof query.queryKey[0] === 'string' && query.queryKey[0] === 'calendar-items') ||
      (typeof query.queryKey[0] === 'string' && query.queryKey[0].startsWith('/api/calendar/items'))
  });
};

/**
 * Invalidate ALL app queries to ensure consistency across entire application
 * Use after any mutation that affects multiple views (create/update/delete)
 * 
 * INDUSTRY STANDARD: Comprehensive invalidation prevents cache inconsistencies
 * and ensures lightning-fast optimistic UI updates remain in sync with server
 */
export const invalidateAllQueries = (queryClient: QueryClient) => {
  // Calendar items (calendar view)
  invalidateCalendarQueries(queryClient);
  
  // Vehicles and vehicle items (vehicle section)
  queryClient.invalidateQueries({ 
    predicate: (query) => 
      typeof query.queryKey[0] === 'string' && 
      (query.queryKey[0].startsWith('/api/vehicles') ||
       query.queryKey[0].startsWith('/api/vehicle-items'))
  });
  
  // Asset items (assets section)
  queryClient.invalidateQueries({ 
    predicate: (query) => 
      typeof query.queryKey[0] === 'string' && 
      (query.queryKey[0].startsWith('/api/asset-items') ||
       query.queryKey[0].startsWith('/api/assets'))
  });
  
  // Task actions (task actions section)
  queryClient.invalidateQueries({ 
    predicate: (query) => 
      typeof query.queryKey[0] === 'string' && 
      query.queryKey[0].startsWith('/api/task-actions')
  });
  
  // Tax & Legal compliances (tax & legal section)
  queryClient.invalidateQueries({ 
    predicate: (query) => 
      typeof query.queryKey[0] === 'string' && 
      query.queryKey[0].startsWith('/api/tax-legal-compliances')
  });
  
  // Aggregated tasks view (tasks page)
  queryClient.invalidateQueries({ 
    predicate: (query) => 
      typeof query.queryKey[0] === 'string' && 
      query.queryKey[0].startsWith('/api/tasks')
  });
  
  // Dashboard statistics
  queryClient.invalidateQueries({ 
    predicate: (query) => 
      typeof query.queryKey[0] === 'string' && 
      query.queryKey[0].startsWith('/api/dashboard')
  });
  
  // Calendar events (quick events)
  queryClient.invalidateQueries({ 
    predicate: (query) => 
      typeof query.queryKey[0] === 'string' && 
      query.queryKey[0].startsWith('/api/calendar-events')
  });
};

/**
 * Restore calendar queries from snapshot (rollback on error)
 */
export const rollbackCalendarQueries = (
  queryClient: QueryClient, 
  previousData: Array<[any, any]>
) => {
  previousData.forEach(([queryKey, data]) => {
    queryClient.setQueryData(queryKey, data);
  });
};

/**
 * Check if a date falls within a query's date range
 * Handles both formats:
 * - ["calendar-items", "2026-01-01", "2026-01-31"]  <-- New format
 * - ["/api/calendar/items?start=2026-01-01&end=2026-01-31"]  <-- Old format
 */
export const isDateInQueryRange = (
  queryKey: readonly any[], 
  itemDate: Date
): boolean => {
  try {
    // New format: ["calendar-items", startDateStr, endDateStr]
    if (queryKey[0] === 'calendar-items' && queryKey.length === 3) {
      const startParam = queryKey[1];
      const endParam = queryKey[2];
      
      if (!startParam || !endParam) return false;
      
      const queryStart = new Date(startParam);
      const queryEnd = new Date(endParam);
      
      // Normalize itemDate to start of day for comparison
      const itemDateOnly = new Date(itemDate);
      itemDateOnly.setHours(0, 0, 0, 0);
      
      return itemDateOnly >= queryStart && itemDateOnly <= queryEnd;
    }
    
    // Old format: ["/api/calendar/items?start=...&end=..."]
    if (typeof queryKey[0] === 'string' && queryKey[0].startsWith('/api/calendar/items')) {
      const url = new URL(queryKey[0], 'http://dummy');
      const startParam = url.searchParams.get('start');
      const endParam = url.searchParams.get('end');
      
      if (!startParam || !endParam) return false;
      
      const queryStart = new Date(startParam);
      const queryEnd = new Date(endParam);
      
      return itemDate >= queryStart && itemDate <= queryEnd;
    }
    
    return false;
  } catch {
    return false;
  }
};

/**
 * Add item optimistically to calendar queries
 * Handles both formats: ["calendar-items", ...] and ["/api/calendar/items?..."]
 */
export const addItemOptimistically = (
  queryClient: QueryClient,
  optimisticItem: OptimisticCalendarItem
) => {
  queryClient.setQueriesData(
    { 
      predicate: (query) => {
        if (typeof query.queryKey[0] !== 'string') return false;
        
        // New format: ["calendar-items", startDateStr, endDateStr]
        if (query.queryKey[0] === 'calendar-items') {
          return isDateInQueryRange(query.queryKey, optimisticItem.dueDate);
        }
        
        // Old format: ["/api/calendar/items?..."]
        if (query.queryKey[0].startsWith('/api/calendar/items')) {
          return isDateInQueryRange(query.queryKey, optimisticItem.dueDate);
        }
        
        return false;
      }
    },
    (old: any) => {
      if (!old) return [optimisticItem];
      return [...old, optimisticItem];
    }
  );
};

/**
 * Remove item optimistically from calendar queries
 * Handles both formats: ["calendar-items", ...] and ["/api/calendar/items?..."]
 */
export const removeItemOptimistically = (
  queryClient: QueryClient,
  itemId: string
) => {
  queryClient.setQueriesData(
    { 
      predicate: (query) => 
        (typeof query.queryKey[0] === 'string' && query.queryKey[0] === 'calendar-items') ||
        (typeof query.queryKey[0] === 'string' && query.queryKey[0].startsWith('/api/calendar/items'))
    },
    (old: any) => {
      if (!old) return old;
      return old.filter((item: OptimisticCalendarItem) => item.id !== itemId);
    }
  );
};

/**
 * Update item optimistically in calendar queries
 * Handles both formats: ["calendar-items", ...] and ["/api/calendar/items?..."]
 */
export const updateItemOptimistically = (
  queryClient: QueryClient,
  itemId: string,
  updates: Partial<OptimisticCalendarItem>
) => {
  queryClient.setQueriesData(
    { 
      predicate: (query) => 
        (typeof query.queryKey[0] === 'string' && query.queryKey[0] === 'calendar-items') ||
        (typeof query.queryKey[0] === 'string' && query.queryKey[0].startsWith('/api/calendar/items'))
    },
    (old: any) => {
      if (!old) return old;
      return old.map((item: OptimisticCalendarItem) => 
        item.id === itemId ? { ...item, ...updates } : item
      );
    }
  );
};

/**
 * Generate temporary ID for optimistic items
 */
export const generateTempId = () => `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

/**
 * Complete optimistic create flow
 * Returns context for rollback
 */
export const optimisticCreate = async (
  queryClient: QueryClient,
  optimisticItem: OptimisticCalendarItem
) => {
  await cancelCalendarQueries(queryClient);
  const previousData = snapshotCalendarQueries(queryClient);
  addItemOptimistically(queryClient, optimisticItem);
  return { previousData };
};

/**
 * Complete optimistic delete flow
 * Returns context for rollback
 */
export const optimisticDelete = async (
  queryClient: QueryClient,
  itemId: string
) => {
  await cancelCalendarQueries(queryClient);
  const previousData = snapshotCalendarQueries(queryClient);
  removeItemOptimistically(queryClient, itemId);
  return { previousData };
};

/**
 * Complete optimistic update flow
 * Returns context for rollback
 */
export const optimisticUpdate = async (
  queryClient: QueryClient,
  itemId: string,
  updates: Partial<OptimisticCalendarItem>
) => {
  await cancelCalendarQueries(queryClient);
  const previousData = snapshotCalendarQueries(queryClient);
  updateItemOptimistically(queryClient, itemId, updates);
  return { previousData };
};

// ============================================================================
// VEHICLE-SPECIFIC OPTIMISTIC UPDATES (Lightning Fast UI)
// ============================================================================

/**
 * Cancel all vehicle queries to prevent race conditions
 */
export const cancelVehicleQueries = async (queryClient: QueryClient) => {
  await queryClient.cancelQueries({ 
    predicate: (query) => 
      typeof query.queryKey[0] === 'string' && 
      query.queryKey[0].startsWith('/api/vehicles')
  });
};

/**
 * Get snapshot of all vehicle data for rollback
 */
export const snapshotVehicleQueries = (queryClient: QueryClient) => {
  return queryClient.getQueriesData({ 
    predicate: (query) => 
      typeof query.queryKey[0] === 'string' && 
      query.queryKey[0].startsWith('/api/vehicles')
  });
};

/**
 * Restore vehicle queries from snapshot (rollback on error)
 */
export const rollbackVehicleQueries = (
  queryClient: QueryClient, 
  previousData: Array<[any, any]>
) => {
  previousData.forEach(([queryKey, data]) => {
    queryClient.setQueryData(queryKey, data);
  });
};

/**
 * Invalidate all vehicle queries to sync with server
 */
export const invalidateVehicleQueries = (queryClient: QueryClient) => {
  queryClient.invalidateQueries({ 
    predicate: (query) => 
      typeof query.queryKey[0] === 'string' && 
      query.queryKey[0].startsWith('/api/vehicles')
  });
  // Also invalidate calendar since vehicles appear there
  invalidateCalendarQueries(queryClient);
};

/**
 * Remove vehicle optimistically from all queries
 */
export const removeVehicleOptimistically = (
  queryClient: QueryClient,
  vehicleId: string
) => {
  queryClient.setQueriesData(
    { 
      predicate: (query) => 
        typeof query.queryKey[0] === 'string' && 
        query.queryKey[0].startsWith('/api/vehicles')
    },
    (old: any) => {
      if (!old) return old;
      if (Array.isArray(old)) {
        return old.filter((vehicle: any) => vehicle.id !== vehicleId);
      }
      return old;
    }
  );
};

/**
 * Update vehicle optimistically in all queries
 */
export const updateVehicleOptimistically = (
  queryClient: QueryClient,
  vehicleId: string,
  updates: any
) => {
  queryClient.setQueriesData(
    { 
      predicate: (query) => 
        typeof query.queryKey[0] === 'string' && 
        query.queryKey[0].startsWith('/api/vehicles')
    },
    (old: any) => {
      if (!old) return old;
      if (Array.isArray(old)) {
        return old.map((vehicle: any) => 
          vehicle.id === vehicleId ? { ...vehicle, ...updates } : vehicle
        );
      }
      return old;
    }
  );
};

/**
 * Complete optimistic vehicle delete flow
 * Returns context for rollback
 */
export const optimisticDeleteVehicle = async (
  queryClient: QueryClient,
  vehicleId: string
) => {
  await cancelVehicleQueries(queryClient);
  const previousData = snapshotVehicleQueries(queryClient);
  removeVehicleOptimistically(queryClient, vehicleId);
  return { previousData };
};

/**
 * Complete optimistic vehicle update flow
 * Returns context for rollback
 */
export const optimisticUpdateVehicle = async (
  queryClient: QueryClient,
  vehicleId: string,
  updates: any
) => {
  await cancelVehicleQueries(queryClient);
  const previousData = snapshotVehicleQueries(queryClient);
  updateVehicleOptimistically(queryClient, vehicleId, updates);
  return { previousData };
};

// ============================================================================
// ASSET-SPECIFIC OPTIMISTIC UPDATES (Lightning Fast UI)
// ============================================================================

export const cancelAssetQueries = async (queryClient: QueryClient) => {
  await queryClient.cancelQueries({
    predicate: (query) =>
      typeof query.queryKey[0] === "string" && query.queryKey[0].startsWith("/api/assets"),
  });
};

export const snapshotAssetQueries = (queryClient: QueryClient) => {
  return queryClient.getQueriesData({
    predicate: (query) =>
      typeof query.queryKey[0] === "string" && query.queryKey[0].startsWith("/api/assets"),
  });
};

export const rollbackAssetQueries = (
  queryClient: QueryClient,
  previousData: Array<[any, any]>,
) => {
  previousData.forEach(([queryKey, data]) => {
    queryClient.setQueryData(queryKey, data);
  });
};

export const invalidateAssetQueries = (queryClient: QueryClient) => {
  queryClient.invalidateQueries({
    predicate: (query) =>
      typeof query.queryKey[0] === "string" && query.queryKey[0].startsWith("/api/assets"),
  });
  invalidateCalendarQueries(queryClient);
};

export const removeAssetOptimistically = (queryClient: QueryClient, assetId: string) => {
  queryClient.setQueriesData(
    {
      predicate: (query) =>
        typeof query.queryKey[0] === "string" && query.queryKey[0].startsWith("/api/assets"),
    },
    (old: any) => {
      if (!old) return old;
      if (Array.isArray(old)) {
        return old.filter((asset: any) => asset.id !== assetId);
      }
      return old;
    },
  );
};

export const updateAssetOptimistically = (
  queryClient: QueryClient,
  assetId: string,
  updates: any,
) => {
  queryClient.setQueriesData(
    {
      predicate: (query) =>
        typeof query.queryKey[0] === "string" && query.queryKey[0].startsWith("/api/assets"),
    },
    (old: any) => {
      if (!old) return old;
      if (Array.isArray(old)) {
        return old.map((asset: any) => (asset.id === assetId ? { ...asset, ...updates } : asset));
      }
      return old;
    },
  );
};

export const optimisticDeleteAsset = async (queryClient: QueryClient, assetId: string) => {
  await cancelAssetQueries(queryClient);
  const previousData = snapshotAssetQueries(queryClient);
  removeAssetOptimistically(queryClient, assetId);
  return { previousData };
};

export const optimisticUpdateAsset = async (
  queryClient: QueryClient,
  assetId: string,
  updates: any,
) => {
  await cancelAssetQueries(queryClient);
  const previousData = snapshotAssetQueries(queryClient);
  updateAssetOptimistically(queryClient, assetId, updates);
  return { previousData };
};

// ============================================================================
// TASK ACTION (PARENT) OPTIMISTIC UPDATES (Lightning Fast UI)
// ============================================================================

export const cancelTaskActionQueries = async (queryClient: QueryClient) => {
  await queryClient.cancelQueries({
    predicate: (query) =>
      typeof query.queryKey[0] === "string" &&
      query.queryKey[0].startsWith("/api/task-actions"),
  });
};

export const snapshotTaskActionQueries = (queryClient: QueryClient) => {
  return queryClient.getQueriesData({
    predicate: (query) =>
      typeof query.queryKey[0] === "string" &&
      query.queryKey[0].startsWith("/api/task-actions"),
  });
};

export const rollbackTaskActionQueries = (
  queryClient: QueryClient,
  previousData: Array<[any, any]>,
) => {
  previousData.forEach(([queryKey, data]) => {
    queryClient.setQueryData(queryKey, data);
  });
};

export const invalidateTaskActionQueries = (queryClient: QueryClient) => {
  queryClient.invalidateQueries({
    predicate: (query) =>
      typeof query.queryKey[0] === "string" &&
      query.queryKey[0].startsWith("/api/task-actions"),
  });
  invalidateCalendarQueries(queryClient);
};

export const removeTaskActionOptimistically = (
  queryClient: QueryClient,
  taskActionId: string,
) => {
  queryClient.setQueriesData(
    {
      predicate: (query) =>
        typeof query.queryKey[0] === "string" &&
        query.queryKey[0].startsWith("/api/task-actions"),
    },
    (old: any) => {
      if (!old) return old;
      if (Array.isArray(old)) {
        return old.filter((ta: any) => ta.id !== taskActionId);
      }
      return old;
    },
  );
};

export const updateTaskActionOptimistically = (
  queryClient: QueryClient,
  taskActionId: string,
  updates: any,
) => {
  queryClient.setQueriesData(
    {
      predicate: (query) =>
        typeof query.queryKey[0] === "string" &&
        query.queryKey[0].startsWith("/api/task-actions"),
    },
    (old: any) => {
      if (!old) return old;
      if (Array.isArray(old)) {
        return old.map((ta: any) => (ta.id === taskActionId ? { ...ta, ...updates } : ta));
      }
      return old;
    },
  );
};

export const optimisticDeleteTaskAction = async (
  queryClient: QueryClient,
  taskActionId: string,
) => {
  await cancelTaskActionQueries(queryClient);
  const previousData = snapshotTaskActionQueries(queryClient);
  removeTaskActionOptimistically(queryClient, taskActionId);
  return { previousData };
};

export const optimisticUpdateTaskAction = async (
  queryClient: QueryClient,
  taskActionId: string,
  updates: any,
) => {
  await cancelTaskActionQueries(queryClient);
  const previousData = snapshotTaskActionQueries(queryClient);
  updateTaskActionOptimistically(queryClient, taskActionId, updates);
  return { previousData };
};

// ============================================================================
// TAX & LEGAL COMPLIANCE OPTIMISTIC UPDATES (Lightning Fast UI)
// ============================================================================

export const cancelTaxLegalComplianceQueries = async (queryClient: QueryClient) => {
  await queryClient.cancelQueries({
    predicate: (query) =>
      typeof query.queryKey[0] === "string" &&
      query.queryKey[0].startsWith("/api/tax-legal-compliances"),
  });
};

export const snapshotTaxLegalComplianceQueries = (queryClient: QueryClient) => {
  return queryClient.getQueriesData({
    predicate: (query) =>
      typeof query.queryKey[0] === "string" &&
      query.queryKey[0].startsWith("/api/tax-legal-compliances"),
  });
};

export const rollbackTaxLegalComplianceQueries = (
  queryClient: QueryClient,
  previousData: Array<[any, any]>,
) => {
  previousData.forEach(([queryKey, data]) => {
    queryClient.setQueryData(queryKey, data);
  });
};

export const invalidateTaxLegalComplianceQueries = (queryClient: QueryClient) => {
  queryClient.invalidateQueries({
    predicate: (query) =>
      typeof query.queryKey[0] === "string" &&
      query.queryKey[0].startsWith("/api/tax-legal-compliances"),
  });
};

export const removeTaxLegalComplianceOptimistically = (
  queryClient: QueryClient,
  complianceId: string,
) => {
  queryClient.setQueriesData(
    {
      predicate: (query) =>
        typeof query.queryKey[0] === "string" &&
        query.queryKey[0].startsWith("/api/tax-legal-compliances"),
    },
    (old: any) => {
      if (!old) return old;
      if (Array.isArray(old)) {
        return old.filter((c: any) => c.id !== complianceId);
      }
      return old;
    },
  );
};

export const optimisticDeleteTaxLegalCompliance = async (
  queryClient: QueryClient,
  complianceId: string,
) => {
  await cancelTaxLegalComplianceQueries(queryClient);
  const previousData = snapshotTaxLegalComplianceQueries(queryClient);
  removeTaxLegalComplianceOptimistically(queryClient, complianceId);
  return { previousData };
};

// ============================================================================
// VEHICLE ITEM-SPECIFIC OPTIMISTIC UPDATES (Lightning Fast Task UI)
// ============================================================================

/**
 * Cancel all vehicle-item queries to prevent race conditions
 */
export const cancelVehicleItemQueries = async (queryClient: QueryClient) => {
  await queryClient.cancelQueries({ queryKey: ["/api/vehicle-items"] });
};

/**
 * Get snapshot of vehicle-item data for rollback
 */
export const snapshotVehicleItemQueries = (queryClient: QueryClient) => {
  return queryClient.getQueryData(["/api/vehicle-items"]);
};

/**
 * Restore vehicle-item queries from snapshot (rollback on error)
 */
export const rollbackVehicleItemQueries = (
  queryClient: QueryClient, 
  previousData: any,
  tempItemId?: string
) => {
  // Ensure previousData is always an array to prevent .filter() errors
  queryClient.setQueryData(["/api/vehicle-items"], Array.isArray(previousData) ? previousData : []);
  
  // ⭐ Also remove optimistic reminder schedules if temp ID provided
  if (tempItemId) {
    removeReminderSchedulesOptimistically(queryClient, 'vehicle_item', tempItemId);
  }
};

/**
 * Invalidate vehicle-item queries to sync with server
 */
export const invalidateVehicleItemQueries = (queryClient: QueryClient) => {
  queryClient.invalidateQueries({ queryKey: ["/api/vehicle-items"] });
  // Also invalidate parent vehicles list (for item count updates)
  invalidateVehicleQueries(queryClient);
};

/**
 * Add vehicle item optimistically
 */
export const addVehicleItemOptimistically = (
  queryClient: QueryClient,
  optimisticItem: any
) => {
  queryClient.setQueryData(["/api/vehicle-items"], (old: any) => {
    if (!old) return [optimisticItem];
    return [...old, optimisticItem];
  });
  
  // Update parent vehicle's item count
  queryClient.setQueriesData(
    { 
      predicate: (query) => 
        typeof query.queryKey[0] === 'string' && 
        query.queryKey[0].startsWith('/api/vehicles')
    },
    (old: any) => {
      if (!old) return old;
      if (Array.isArray(old)) {
        return old.map((v: any) =>
          v.id === optimisticItem.vehicleId 
            ? { ...v, _count: { ...v._count, vehicleItems: (v._count?.vehicleItems || 0) + 1 } } 
            : v
        );
      }
      return old;
    }
  );
};

/**
 * Remove vehicle item optimistically
 */
export const removeVehicleItemOptimistically = (
  queryClient: QueryClient,
  itemId: string,
  vehicleId: string
) => {
  queryClient.setQueryData(["/api/vehicle-items"], (old: any) => {
    if (!old) return old;
    return old.filter((item: any) => item.id !== itemId);
  });
  
  // Update parent vehicle's item count
  queryClient.setQueriesData(
    { 
      predicate: (query) => 
        typeof query.queryKey[0] === 'string' && 
        query.queryKey[0].startsWith('/api/vehicles')
    },
    (old: any) => {
      if (!old) return old;
      if (Array.isArray(old)) {
        return old.map((v: any) =>
          v.id === vehicleId 
            ? { ...v, _count: { ...v._count, vehicleItems: Math.max(0, (v._count?.vehicleItems || 0) - 1) } } 
            : v
        );
      }
      return old;
    }
  );
};

/**
 * Update vehicle item optimistically
 * ⚡ NOW UPDATES ALL RELATED CACHES FOR INSTANT UI FEEDBACK
 */
export const updateVehicleItemOptimistically = (
  queryClient: QueryClient,
  itemId: string,
  updates: any
) => {
  // ✅ Update list cache (already working)
  queryClient.setQueryData(["/api/vehicle-items"], (old: any) => {
    if (!old) return old;
    return old.map((item: any) => 
      item.id === itemId ? { ...item, ...updates } : item
    );
  });
  
  // ✅ NEW: Update detail cache (fixes stale UI in edit dialog)
  queryClient.setQueryData(["/api/vehicle-items", itemId], (old: any) => {
    if (!old) return old;
    return { ...old, ...updates };
  });
  
  // ✅ NEW: Update reminder schedules if recipients/recurrence changed
  if (updates.emailRecipients !== undefined || 
      updates.whatsappRecipients !== undefined ||
      updates.recurrenceData !== undefined) {
    updateReminderSchedulesOptimistically(
      queryClient,
      'vehicle_item',
      itemId,
      updates
    );
  }
};

/**
 * ════════════════════════════════════════════════════════════════
 * OPTIMISTIC REMINDER SCHEDULE UPDATES
 * ════════════════════════════════════════════════════════════════
 */

/**
 * Calculate optimistic reminder schedule from task data
 * Used to show reminders instantly when creating a task
 * ⭐ Now creates ONE schedule with email array (not one per email)
 */
export const calculateOptimisticReminderSchedule = (
  taskData: any,
  entityType: string,
  entityId: string,
  recipientEmails: string[]  // ⭐ Changed to array
) => {
  // Calculate reminder date from due date and reminder days
  const dueDate = new Date(taskData.dueDate);
  const reminderDays = taskData.reminderDays || 7;
  const reminderDate = new Date(dueDate);
  reminderDate.setDate(reminderDate.getDate() - reminderDays);
  
  // Determine schedule type and occurrences
  let scheduleType: 'one_time' | 'finite' | 'infinite' = 'one_time';
  let totalOccurrences = 1;
  let reminderInterval = null;
  
  if (taskData.isRecurring && taskData.recurrenceData) {
    const { pattern, endType, endCount } = taskData.recurrenceData;
    
    if (endType === 'never') {
      scheduleType = 'infinite';
      totalOccurrences = 10; // Show 10 for infinite
      reminderInterval = pattern || 'daily';
    } else if (endType === 'after' && endCount) {
      scheduleType = 'finite';
      totalOccurrences = endCount;
      reminderInterval = pattern || 'daily';
    } else if (endType === 'on') {
      scheduleType = 'finite';
      // Calculate occurrences from start to end date
      totalOccurrences = 10; // Simplified - could calculate exact count
      reminderInterval = pattern || 'daily';
    }
  }
  
  return {
    id: `temp-reminder-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    userId: 'temp', // Will be replaced with real user ID
    entityType,
    entityId,
    taskTitle: taskData.title,
    taskCategory: taskData.category,
    scheduleType,
    reminderDate: reminderDate.toISOString(),
    reminderInterval,
    reminderDaysBefore: reminderDays,
    totalOccurrences: scheduleType === 'infinite' ? null : totalOccurrences,
    occurrencesRemaining: scheduleType === 'infinite' ? null : totalOccurrences,
    endDate: taskData.recurrenceData?.endDate || null,
    recipientEmail: recipientEmails,  // ⭐ Now an array!
    recipientPhone: taskData.whatsappRecipients || [],  // ⭐ Array
    notificationChannels: taskData.notificationChannels || ['email'],
    reminderTimes: taskData.reminderTimes || ['09:00'],
    status: 'pending',
    isActive: true,
    recurrenceData: taskData.recurrenceData || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastSentAt: null,
  };
};

/**
 * Add optimistic reminder schedules for a task
 * ⭐ Creates ONE schedule with email array (not one per email)
 */
export const addReminderSchedulesOptimistically = (
  queryClient: QueryClient,
  entityType: string,
  entityId: string,
  taskData: any
) => {
  const emailRecipients = Array.isArray(taskData.emailRecipients) 
    ? taskData.emailRecipients 
    : taskData.emailRecipients ? [taskData.emailRecipients] : [];
  
  if (emailRecipients.length === 0) {
    // No email recipients, no reminders to create
    return;
  }
  
  // ⭐ Create SINGLE optimistic schedule with email array
  const optimisticSchedule = calculateOptimisticReminderSchedule(
    taskData, 
    entityType, 
    entityId, 
    emailRecipients  // Pass array of all emails
  );
  
  // Add to query cache - reminders appear instantly!
  queryClient.setQueryData(
    [`/api/reminder-schedules/entity/${entityType}/${entityId}`],
    [optimisticSchedule]  // ⭐ Array with single schedule
  );
  
  console.log(`⚡ [Optimistic] Added 1 reminder schedule with ${emailRecipients.length} recipient(s) for ${entityId}`);
};

/**
 * Remove optimistic reminder schedules (on rollback)
 */
export const removeReminderSchedulesOptimistically = (
  queryClient: QueryClient,
  entityType: string,
  entityId: string
) => {
  queryClient.removeQueries({
    queryKey: [`/api/reminder-schedules/entity/${entityType}/${entityId}`],
  });
  
  console.log(`⚡ [Optimistic] Removed reminder schedules for ${entityId}`);
};

/**
 * Replace optimistic reminder schedules with real data
 */
export const replaceOptimisticReminderSchedules = (
  queryClient: QueryClient,
  entityType: string,
  tempEntityId: string,
  realEntityId: string
) => {
  // Remove temp schedules
  queryClient.removeQueries({
    queryKey: [`/api/reminder-schedules/entity/${entityType}/${tempEntityId}`],
  });
  
  // Invalidate real entity query to fetch from server
  queryClient.invalidateQueries({
    queryKey: [`/api/reminder-schedules/entity/${entityType}/${realEntityId}`],
  });
  
  console.log(`⚡ [Optimistic] Replaced temp reminder schedules (${tempEntityId} → ${realEntityId})`);
};

/**
 * ⚡ Update reminder schedules optimistically for EDIT mode
 * Recalculates and updates reminder cache based on new task settings
 */
/**
 * ⭐ SIMPLIFIED: Update reminder schedule optimistically (array-based)
 * Now updates ONE schedule with email arrays (not multiple schedules)
 */
export const updateReminderSchedulesOptimistically = (
  queryClient: QueryClient,
  entityType: string,
  entityId: string,
  updates: any
) => {
  const queryKey = [`/api/reminder-schedules/entity/${entityType}/${entityId}`];
  
  // Get existing reminders from cache
  const existingReminders = queryClient.getQueryData(queryKey) as any[];
  
  const emailRecipients = updates.emailRecipients || [];
  const whatsappRecipients = updates.whatsappRecipients || [];
  
  if (!existingReminders || existingReminders.length === 0) {
    // ⭐ No existing reminders, create ONE schedule with email arrays
    if (emailRecipients.length === 0) {
      console.log(`⚡ [Optimistic] No recipients, skipping reminder creation`);
      return;
    }
    
    const newSchedule = calculateOptimisticReminderSchedule(
      updates,
      entityType,
      entityId,
      emailRecipients  // Pass all emails as array
    );
    
    queryClient.setQueryData(queryKey, [newSchedule]);  // Single schedule in array
    console.log(`⚡ [Optimistic] Created 1 reminder schedule with ${emailRecipients.length} recipient(s) for ${entityId}`);
    return;
  }
  
  // ⭐ UPDATE EXISTING SINGLE SCHEDULE
  const existingSchedule = existingReminders[0];  // Should only be one!
  
  // Determine new occurrence count
  let newTotalOccurrences = existingSchedule.totalOccurrences;
  if (updates.recurrenceData) {
    if (updates.recurrenceData.endType === 'after') {
      newTotalOccurrences = updates.recurrenceData.endCount;
    } else if (updates.recurrenceData.endType === 'never') {
      newTotalOccurrences = null; // infinite
    }
  }
  
  // Calculate new remaining (preserve history!)
  const alreadySent = (existingSchedule.totalOccurrences || 0) - (existingSchedule.occurrencesRemaining || 0);
  const newRemaining = newTotalOccurrences !== null 
    ? Math.max(0, newTotalOccurrences - alreadySent)
    : existingSchedule.occurrencesRemaining;
  
  // ⭐ Update schedule with new email arrays (simple replace!)
  const updatedSchedule = {
    ...existingSchedule,
    recipientEmail: emailRecipients,  // ⭐ Replace array
    recipientPhone: whatsappRecipients,  // ⭐ Replace array
    totalOccurrences: newTotalOccurrences,
    occurrencesRemaining: newRemaining,
    reminderTimes: updates.reminderTimes || existingSchedule.reminderTimes,
    status: newRemaining > 0 ? 'pending' : 'completed',
    isActive: newRemaining > 0,
  };
  
  // Update cache
  queryClient.setQueryData(queryKey, [updatedSchedule]);  // Single schedule in array
  
  console.log(`⚡ [Optimistic] Updated reminder schedule for ${entityId}:`);
  console.log(`   - Recipients: ${emailRecipients.length} email(s), ${whatsappRecipients.length} phone(s)`);
  console.log(`   - Occurrences: ${newRemaining} remaining of ${newTotalOccurrences || '∞'}`);
};

/**
 * Complete optimistic vehicle item create flow
 * Now includes optimistic reminder schedules for instant display
 */
export const optimisticCreateVehicleItem = async (
  queryClient: QueryClient,
  optimisticItem: any
) => {
  await cancelVehicleItemQueries(queryClient);
  const previousData = snapshotVehicleItemQueries(queryClient);
  
  // Add vehicle item optimistically
  addVehicleItemOptimistically(queryClient, optimisticItem);
  
  // ⭐ Add reminder schedules optimistically (if task has reminders)
  if (optimisticItem.reminderDays && optimisticItem.emailRecipients) {
    addReminderSchedulesOptimistically(
      queryClient,
      'vehicle_item',
      optimisticItem.id, // temp ID
      optimisticItem
    );
  }
  
  return { previousData };
};

/**
 * Complete optimistic vehicle item delete flow
 */
export const optimisticDeleteVehicleItem = async (
  queryClient: QueryClient,
  itemId: string,
  vehicleId: string
) => {
  await cancelVehicleItemQueries(queryClient);
  const previousData = snapshotVehicleItemQueries(queryClient);
  removeVehicleItemOptimistically(queryClient, itemId, vehicleId);
  return { previousData };
};

/**
 * Complete optimistic vehicle item update flow
 */
export const optimisticUpdateVehicleItem = async (
  queryClient: QueryClient,
  itemId: string,
  updates: any
) => {
  await cancelVehicleItemQueries(queryClient);
  const previousData = snapshotVehicleItemQueries(queryClient);
  updateVehicleItemOptimistically(queryClient, itemId, updates);
  return { previousData };
};

// ============================================================================
// ASSET ITEM-SPECIFIC OPTIMISTIC UPDATES (Lightning Fast Task UI)
// ============================================================================

export const cancelAssetItemQueries = async (queryClient: QueryClient, assetId: string) => {
  // Asset items use query key: /api/assets/${assetId}/tasks
  await queryClient.cancelQueries({ queryKey: [`/api/assets/${assetId}/tasks`] });
};

export const snapshotAssetItemQueries = (queryClient: QueryClient, assetId: string) => {
  return queryClient.getQueryData([`/api/assets/${assetId}/tasks`]);
};

export const rollbackAssetItemQueries = (
  queryClient: QueryClient,
  previousData: any,
  assetId: string
) => {
  queryClient.setQueryData([`/api/assets/${assetId}/tasks`], previousData);
};

export const removeAssetItemOptimistically = (
  queryClient: QueryClient,
  itemId: string,
  assetId: string
) => {
  // Remove from asset tasks list (query key: /api/assets/${assetId}/tasks)
  queryClient.setQueryData([`/api/assets/${assetId}/tasks`], (old: any) => {
    if (!old) return old;
    if (Array.isArray(old)) {
      return old.filter((item: any) => item.id !== itemId);
    }
    return old;
  });
  
  // Remove occurrence reminders cache for this item
  queryClient.removeQueries({
    queryKey: [`/api/task-occurrences/entity/asset_item/${itemId}`]
  });
};

export const optimisticDeleteAssetItem = async (
  queryClient: QueryClient,
  itemId: string,
  assetId: string
) => {
  await cancelAssetItemQueries(queryClient, assetId);
  const previousData = snapshotAssetItemQueries(queryClient, assetId);
  removeAssetItemOptimistically(queryClient, itemId, assetId);
  return { previousData };
};

// ============================================================================
// TASK ACTION ITEM-SPECIFIC OPTIMISTIC UPDATES (Lightning Fast Task UI)
// ============================================================================

export const cancelTaskActionItemQueries = async (queryClient: QueryClient, taskActionId: string) => {
  // Task action items use query key: /api/task-actions/${taskActionId}/tasks
  await queryClient.cancelQueries({ queryKey: [`/api/task-actions/${taskActionId}/tasks`] });
};

export const snapshotTaskActionItemQueries = (queryClient: QueryClient, taskActionId: string) => {
  return queryClient.getQueryData([`/api/task-actions/${taskActionId}/tasks`]);
};

export const rollbackTaskActionItemQueries = (
  queryClient: QueryClient,
  previousData: any,
  taskActionId: string
) => {
  queryClient.setQueryData([`/api/task-actions/${taskActionId}/tasks`], previousData);
};

export const removeTaskActionItemOptimistically = (
  queryClient: QueryClient,
  itemId: string,
  taskActionId: string
) => {
  // Remove from task action tasks list (query key: /api/task-actions/${taskActionId}/tasks)
  queryClient.setQueryData([`/api/task-actions/${taskActionId}/tasks`], (old: any) => {
    if (!old) return old;
    if (Array.isArray(old)) {
      return old.filter((item: any) => item.id !== itemId);
    }
    return old;
  });
  
  // Remove occurrence reminders cache for this item
  queryClient.removeQueries({
    queryKey: [`/api/task-occurrences/entity/task_action_item/${itemId}`]
  });
};

export const optimisticDeleteTaskActionItem = async (
  queryClient: QueryClient,
  itemId: string,
  taskActionId: string
) => {
  await cancelTaskActionItemQueries(queryClient, taskActionId);
  const previousData = snapshotTaskActionItemQueries(queryClient, taskActionId);
  removeTaskActionItemOptimistically(queryClient, itemId, taskActionId);
  return { previousData };
};

// ============================================================================
// TAX LEGAL ITEM-SPECIFIC OPTIMISTIC UPDATES (Lightning Fast Task UI)
// ============================================================================

export const cancelTaxLegalItemQueries = async (queryClient: QueryClient, complianceId: string) => {
  // Tax legal items use query key: /api/tax-legal-compliances/${complianceId}/items
  await queryClient.cancelQueries({ queryKey: [`/api/tax-legal-compliances/${complianceId}/items`] });
};

export const snapshotTaxLegalItemQueries = (queryClient: QueryClient, complianceId: string) => {
  return queryClient.getQueryData([`/api/tax-legal-compliances/${complianceId}/items`]);
};

export const rollbackTaxLegalItemQueries = (
  queryClient: QueryClient,
  previousData: any,
  complianceId: string
) => {
  queryClient.setQueryData([`/api/tax-legal-compliances/${complianceId}/items`], previousData);
};

export const removeTaxLegalItemOptimistically = (
  queryClient: QueryClient,
  itemId: string,
  complianceId: string
) => {
  // Remove from tax legal items list (query key: /api/tax-legal-compliances/${complianceId}/items)
  queryClient.setQueryData([`/api/tax-legal-compliances/${complianceId}/items`], (old: any) => {
    if (!old) return old;
    if (Array.isArray(old)) {
      return old.filter((item: any) => item.id !== itemId);
    }
    return old;
  });
  
  // Remove occurrence reminders cache for this item
  queryClient.removeQueries({
    queryKey: [`/api/task-occurrences/entity/tax_legal_item/${itemId}`]
  });
};

export const optimisticDeleteTaxLegalItem = async (
  queryClient: QueryClient,
  itemId: string,
  complianceId: string
) => {
  await cancelTaxLegalItemQueries(queryClient, complianceId);
  const previousData = snapshotTaxLegalItemQueries(queryClient, complianceId);
  removeTaxLegalItemOptimistically(queryClient, itemId, complianceId);
  return { previousData };
};

