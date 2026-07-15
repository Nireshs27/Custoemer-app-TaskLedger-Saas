/**
 * Shared helper for computing parent entity summaries from occurrence_reminders
 * 
 * Single source of truth for status pills across Vehicles, Assets, Task Actions, Tax & Legal
 * 
 * CORRECTED LOGIC:
 * - occurrence_reminders.entity_id stores CHILD ITEM IDs (vehicle_items.id, asset_items.id, etc.)
 * - We must JOIN child items table and group by parent FK to get parent summaries
 */

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { occurrenceReminders } from '@shared/schema';
import { eq, and, sql, inArray } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';

export interface OccurrenceSummary {
  itemsCount: number;
  pendingCount: number;
  overdueCount: number;
  dueTodayCount: number;
  upcomingCount: number;
  nextDueOccurrence: {
    title: string;
    notes: string | null;
    dueDateLocalYmd: string;
    occurrenceKey: string;
    entityId: string;
  } | null;
}

/**
 * Get today's date in YYYY-MM-DD format (IST timezone)
 */
function getTodayYmd(): string {
  const now = new Date();
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const year = ist.getFullYear();
  const month = String(ist.getMonth() + 1).padStart(2, '0');
  const day = String(ist.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Compute summaries for multiple parent entities in a single query
 * 
 * This is the CORRECT implementation that:
 * 1. JOINs occurrence_reminders with child items table
 * 2. Groups by parent FK (vehicleId, assetId, etc.)
 * 3. Returns one summary per parent
 * 
 * @param db - Drizzle database instance
 * @param params - Configuration for the query
 * @returns Map of parentId -> OccurrenceSummary
 */
export async function getOccurrenceSummariesGroupedByParent(
  db: NodePgDatabase<any>,
  params: {
    userId: string;
    parentIds: string[];
    entityType: 'vehicle_item' | 'asset_item' | 'task_action_item' | 'tax_legal_item';
    itemsTable: PgTable;
    itemIdCol: PgColumn;
    parentIdCol: PgColumn;
  }
): Promise<Map<string, OccurrenceSummary>> {
  const { userId, parentIds, entityType, itemsTable, itemIdCol, parentIdCol } = params;

  if (parentIds.length === 0) {
    return new Map();
  }

  const todayYmd = getTodayYmd();

  // Step 1: Get aggregated counts per parent
  // JOIN occurrence_reminders with items table on entity_id = items.id
  // GROUP BY parent ID
  const countsQuery = db
    .select({
      parentId: sql<string>`${parentIdCol}`,
      itemsCount: sql<number>`COUNT(DISTINCT ${itemIdCol})::int`,
      pendingCount: sql<number>`COUNT(*) FILTER (WHERE ${occurrenceReminders.taskStatus} = 'pending')::int`,
      overdueCount: sql<number>`COUNT(*) FILTER (WHERE ${occurrenceReminders.taskStatus} = 'pending' AND ${occurrenceReminders.dueDateLocalYmd} < ${todayYmd})::int`,
      dueTodayCount: sql<number>`COUNT(*) FILTER (WHERE ${occurrenceReminders.taskStatus} = 'pending' AND ${occurrenceReminders.dueDateLocalYmd} = ${todayYmd})::int`,
      upcomingCount: sql<number>`COUNT(*) FILTER (WHERE ${occurrenceReminders.taskStatus} = 'pending' AND ${occurrenceReminders.dueDateLocalYmd} > ${todayYmd})::int`,
    })
    .from(occurrenceReminders)
    .innerJoin(itemsTable, eq(occurrenceReminders.entityId, itemIdCol))
    .where(
      and(
        eq(occurrenceReminders.userId, userId),
        eq(occurrenceReminders.entityType, entityType),
        inArray(parentIdCol, parentIds)
      )
    )
    .groupBy(sql`${parentIdCol}`);

  const countsResults = await countsQuery;

  // Step 2: Get next due item per parent
  // Use window function to get earliest pending reminder per parent
  const nextDueQuery = db
    .select({
      parentId: sql<string>`${parentIdCol}`,
      title: occurrenceReminders.taskTitle,
      notes: occurrenceReminders.taskNote,
      dueDateLocalYmd: occurrenceReminders.dueDateLocalYmd,
      occurrenceKey: occurrenceReminders.occurrenceKey,
      entityId: occurrenceReminders.entityId,
      rn: sql<number>`ROW_NUMBER() OVER (PARTITION BY ${parentIdCol} ORDER BY ${occurrenceReminders.dueDateLocalYmd} ASC, ${occurrenceReminders.createdAt} ASC)`,
    })
    .from(occurrenceReminders)
    .innerJoin(itemsTable, eq(occurrenceReminders.entityId, itemIdCol))
    .where(
      and(
        eq(occurrenceReminders.userId, userId),
        eq(occurrenceReminders.entityType, entityType),
        eq(occurrenceReminders.taskStatus, 'pending'),
        inArray(parentIdCol, parentIds)
      )
    );

  const nextDueResults = await nextDueQuery;

  // Filter to only first row per parent (rn = 1)
  const nextDueMap = new Map<string, OccurrenceSummary['nextDueOccurrence']>();
  for (const row of nextDueResults) {
    if (row.rn === 1 && !nextDueMap.has(row.parentId)) {
      nextDueMap.set(row.parentId, {
        title: row.title,
        notes: row.notes,
        dueDateLocalYmd: row.dueDateLocalYmd,
        occurrenceKey: row.occurrenceKey,
        entityId: row.entityId,
      });
    }
  }

  // Step 3: Build final map with all parents initialized
  const summaryMap = new Map<string, OccurrenceSummary>();

  // Initialize all parents with zero counts
  for (const parentId of parentIds) {
    summaryMap.set(parentId, {
      itemsCount: 0,
      pendingCount: 0,
      overdueCount: 0,
      dueTodayCount: 0,
      upcomingCount: 0,
      nextDueOccurrence: null,
    });
  }

  // Apply counts from query results
  for (const row of countsResults) {
    summaryMap.set(row.parentId, {
      itemsCount: row.itemsCount,
      pendingCount: row.pendingCount,
      overdueCount: row.overdueCount,
      dueTodayCount: row.dueTodayCount,
      upcomingCount: row.upcomingCount,
      nextDueOccurrence: nextDueMap.get(row.parentId) || null,
    });
  }

  // Attach nextDueOccurrence for parents that have items but no counts yet
  // (This handles edge case where items exist but all reminders are completed)
  for (const [parentId, nextDue] of Array.from(nextDueMap.entries())) {
    const summary = summaryMap.get(parentId);
    if (summary && !summary.nextDueOccurrence) {
      summary.nextDueOccurrence = nextDue;
    }
  }

  return summaryMap;
}

/**
 * Compute summaries for individual entity IDs (for task/item cards)
 * 
 * This queries occurrence_reminders directly by entityId (no JOIN needed)
 * Used for attaching occurrenceSummary to individual items in list endpoints
 * 
 * @param db - Drizzle database instance
 * @param params - Configuration for the query
 * @returns Map of entityId -> OccurrenceSummary
 */
export async function getOccurrenceSummariesForEntityIds(
  db: NodePgDatabase<any>,
  params: {
    userId: string;
    entityIds: string[];
    entityType: 'vehicle_item' | 'asset_item' | 'task_action_item' | 'tax_legal_item';
  }
): Promise<Map<string, OccurrenceSummary>> {
  const { userId, entityIds, entityType } = params;

  if (entityIds.length === 0) {
    return new Map();
  }

  const todayYmd = getTodayYmd();

  // Step 1: Get aggregated counts per entityId
  const countsQuery = db
    .select({
      entityId: occurrenceReminders.entityId,
      itemsCount: sql<number>`1::int`, // Always 1 for individual items
      pendingCount: sql<number>`COUNT(*) FILTER (WHERE ${occurrenceReminders.taskStatus} = 'pending')::int`,
      overdueCount: sql<number>`COUNT(*) FILTER (WHERE ${occurrenceReminders.taskStatus} = 'pending' AND ${occurrenceReminders.dueDateLocalYmd} < ${todayYmd})::int`,
      dueTodayCount: sql<number>`COUNT(*) FILTER (WHERE ${occurrenceReminders.taskStatus} = 'pending' AND ${occurrenceReminders.dueDateLocalYmd} = ${todayYmd})::int`,
      upcomingCount: sql<number>`COUNT(*) FILTER (WHERE ${occurrenceReminders.taskStatus} = 'pending' AND ${occurrenceReminders.dueDateLocalYmd} > ${todayYmd})::int`,
    })
    .from(occurrenceReminders)
    .where(
      and(
        eq(occurrenceReminders.userId, userId),
        eq(occurrenceReminders.entityType, entityType),
        inArray(occurrenceReminders.entityId, entityIds)
      )
    )
    .groupBy(occurrenceReminders.entityId);

  const countsResults = await countsQuery;

  // Step 2: Get next due item per entityId
  const nextDueQuery = db
    .select({
      entityId: occurrenceReminders.entityId,
      title: occurrenceReminders.taskTitle,
      notes: occurrenceReminders.taskNote,
      dueDateLocalYmd: occurrenceReminders.dueDateLocalYmd,
      occurrenceKey: occurrenceReminders.occurrenceKey,
      rn: sql<number>`ROW_NUMBER() OVER (PARTITION BY ${occurrenceReminders.entityId} ORDER BY ${occurrenceReminders.dueDateLocalYmd} ASC, ${occurrenceReminders.createdAt} ASC)`,
    })
    .from(occurrenceReminders)
    .where(
      and(
        eq(occurrenceReminders.userId, userId),
        eq(occurrenceReminders.entityType, entityType),
        eq(occurrenceReminders.taskStatus, 'pending'),
        inArray(occurrenceReminders.entityId, entityIds)
      )
    );

  const nextDueResults = await nextDueQuery;

  // Filter to only first row per entity (rn = 1)
  const nextDueMap = new Map<string, OccurrenceSummary['nextDueOccurrence']>();
  for (const row of nextDueResults) {
    if (row.rn === 1 && !nextDueMap.has(row.entityId)) {
      nextDueMap.set(row.entityId, {
        title: row.title,
        notes: row.notes,
        dueDateLocalYmd: row.dueDateLocalYmd,
        occurrenceKey: row.occurrenceKey,
        entityId: row.entityId,
      });
    }
  }

  // Step 3: Build final map with all entities initialized
  const summaryMap = new Map<string, OccurrenceSummary>();

  // Initialize all entities with zero counts
  for (const entityId of entityIds) {
    summaryMap.set(entityId, {
      itemsCount: 0,
      pendingCount: 0,
      overdueCount: 0,
      dueTodayCount: 0,
      upcomingCount: 0,
      nextDueOccurrence: null,
    });
  }

  // Apply counts from query results
  for (const row of countsResults) {
    summaryMap.set(row.entityId, {
      itemsCount: row.itemsCount,
      pendingCount: row.pendingCount,
      overdueCount: row.overdueCount,
      dueTodayCount: row.dueTodayCount,
      upcomingCount: row.upcomingCount,
      nextDueOccurrence: nextDueMap.get(row.entityId) || null,
    });
  }

  // Attach nextDueOccurrence for entities that have items but no counts yet
  for (const [entityId, nextDue] of Array.from(nextDueMap.entries())) {
    const summary = summaryMap.get(entityId);
    if (summary && !summary.nextDueOccurrence) {
      summary.nextDueOccurrence = nextDue;
    }
  }

  return summaryMap;
}

/**
 * Get status label for summary (for backward compatibility with existing UI)
 */
export function getSummaryStatusLabel(summary: OccurrenceSummary): {
  label: string;
  variant: 'default' | 'success' | 'warning' | 'destructive';
} {
  if (summary.overdueCount > 0) {
    return {
      label: `Overdue (${summary.overdueCount})`,
      variant: 'destructive',
    };
  }

  if (summary.dueTodayCount > 0) {
    return {
      label: `Due Today (${summary.dueTodayCount})`,
      variant: 'warning',
    };
  }

  if (summary.upcomingCount > 0) {
    return {
      label: `Upcoming (${summary.upcomingCount})`,
      variant: 'default',
    };
  }

  return {
    label: 'Up to Date',
    variant: 'success',
  };
}
