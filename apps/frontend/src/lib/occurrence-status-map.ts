import { buildOccurrenceKey } from "@/lib/occurrence-key";

export interface OccurrenceStatusRow {
  occurrenceKey: string;
  status: "completed" | "skipped" | null;
  note?: string | null;
  updatedAt?: string | null;
}

export function mapStatusesByKey(
  rows: Record<string, { status: string; note?: string | null; updatedAt?: string | null }>
): Record<string, OccurrenceStatusRow> {
  const map: Record<string, OccurrenceStatusRow> = {};
  Object.entries(rows || {}).forEach(([key, value]) => {
    map[key] = {
      occurrenceKey: key,
      status: (value?.status as any) ?? null,
      note: value?.note ?? null,
      updatedAt: value?.updatedAt ?? null,
    };
  });
  return map;
}

export function attachCompletionStatus<T extends { taskDateUtcIso: string; completionStatus?: boolean }>(
  occurrences: T[],
  entityType: string,
  entityId: string,
  statusMap: Record<string, OccurrenceStatusRow>
): T[] {
    return occurrences.map((occ, i) => {
        const key = buildOccurrenceKey(entityType, entityId, occ.taskDateUtcIso);
        const row = statusMap[key];
        const completion = row?.status === "completed";
      
        if (i < 12) {
          console.log("[attachCompletionStatus]", {
            i,
            taskDateUtcIso: occ.taskDateUtcIso,
            key,
            mapHit: row?.status ?? null,
            mapKeysCount: Object.keys(statusMap || {}).length,
          });
        }
      
        return { ...occ, completionStatus: completion };
      });      
}

