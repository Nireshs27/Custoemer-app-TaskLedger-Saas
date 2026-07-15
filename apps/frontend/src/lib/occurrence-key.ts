// export function buildOccurrenceKey(entityType: string, entityId: string, taskDateUtcIso: string) {
//   return `${entityType}:${entityId}::${taskDateUtcIso}`;
// }

// export function normalizeOccurrenceIso(date: string | Date): string {
//   const d = typeof date === "string" ? new Date(date) : date;
//   return new Date(d).toISOString();
// }

export function normalizeOccurrenceIso(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString(); // keeps full timestamp
}

export function buildOccurrenceKey(entityType: string, entityId: string, taskDateUtcIso: string) {
  return `${entityType}:${entityId}::${normalizeOccurrenceIso(taskDateUtcIso)}`;
}
