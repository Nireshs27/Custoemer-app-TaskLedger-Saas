export interface CompleteRequestParams {
  entityType: string;
  entityId: string;
  isRecurring: boolean;
  occurrenceTaskDateUtcIso?: string | null;
  occurrenceKey?: string | null;
  notes?: string | null;
  apiRequest: (method: string, url: string, body?: any) => Promise<any>;
}

/**
 * Routes completion to either occurrence completion (recurring) or base task completion (non-recurring).
 */
export async function completeTaskOrOccurrence({
  entityType,
  entityId,
  isRecurring,
  occurrenceTaskDateUtcIso,
  occurrenceKey,
  notes,
  apiRequest,
}: CompleteRequestParams): Promise<void> {
  // ✅ NEW: If occurrenceKey is provided, use DB-driven completion
  if (typeof occurrenceKey === "string" && occurrenceKey.trim().length > 0) {
    await apiRequest("POST", "/api/tasks/complete", {
      occurrenceKey: occurrenceKey.trim(),
      entityType,          // helpful for logs/debug
      entityId,
      completionNotes: notes ?? "",
    });
    return;
  }

  if (isRecurring) {
    if (!occurrenceTaskDateUtcIso) {
      throw new Error("Missing occurrence task date for recurring completion");
    }
    await apiRequest("POST", "/api/task-occurrence/complete", {
      entityType,
      entityId,
      taskDateUtcIso: occurrenceTaskDateUtcIso,
      note: notes ?? null,
    });
    return;
  }

  await apiRequest("POST", "/api/tasks/complete", {
    entityType,
    entityId,
    completionNotes: notes ?? "",
  });
}

