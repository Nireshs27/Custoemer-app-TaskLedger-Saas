export type HeaderStatusInput = {
  isRecurring: boolean;
  entityBaseStatus: string | null | undefined;
  occurrenceKey: string | null;
  statusesMap: Record<string, { status?: string | null }> | null | undefined;
};

/**
 * Compute the status shown in the calendar modal header.
 * - Non-recurring: show the entity base status (pending by default).
 * - Recurring: show completed/skipped only when the selected occurrenceKey
 *   is completed/skipped in the statuses map; otherwise fall back to entity status.
 */
export function getHeaderStatus({
  isRecurring,
  entityBaseStatus,
  occurrenceKey,
  statusesMap,
}: HeaderStatusInput): string {
  if (!isRecurring) {
    return entityBaseStatus ?? "pending";
  }

  const occStatus =
    occurrenceKey && statusesMap ? statusesMap[occurrenceKey]?.status ?? null : null;

  if (occStatus === "completed") return "completed";
  if (occStatus === "skipped") return "skipped";

  return entityBaseStatus ?? "pending";
}

