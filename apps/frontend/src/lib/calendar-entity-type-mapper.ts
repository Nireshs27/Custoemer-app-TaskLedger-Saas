/**
 * Shared entity type mapping for calendar items
 * Prevents duplication and inconsistency across components
 */

export type CalendarEntityType = 'vehicle' | 'asset' | 'event' | 'task_action_item' | 'tax_legal_item';
export type ApiEntityType = 'vehicle_item' | 'asset_item' | 'calendar_event' | 'task_action_item' | 'tax_legal_item';
export type ReminderEntityType = 'vehicle_item' | 'asset_item' | 'calendar_event' | 'task_action_item' | 'tax_legal_item';

/**
 * Convert calendar entityType to API entityType
 * Used for: DELETE, PUT, POST endpoints
 */
export function calendarEntityTypeToApiEntityType(entityType: CalendarEntityType): ApiEntityType {
  switch (entityType) {
    case 'vehicle':
      return 'vehicle_item';
    case 'asset':
      return 'asset_item';
    case 'event':
      return 'calendar_event';
    case 'task_action_item':
      return 'task_action_item';
    case 'tax_legal_item':
      return 'tax_legal_item';
  }
}

/**
 * Convert calendar entityType to reminder entityType
 * Used for: ReminderDisplay component
 */
export function calendarEntityTypeToReminderEntityType(entityType: CalendarEntityType): ReminderEntityType {
  // For most types, reminder entityType === API entityType
  return calendarEntityTypeToApiEntityType(entityType);
}

/**
 * Get API endpoint pattern for entity type
 * Returns the base path without ID
 */
export function getEntityApiPath(entityType: CalendarEntityType): string {
  switch (entityType) {
    case 'vehicle':
      return '/api/vehicle-items';
    case 'asset':
      return '/api/assets/tasks';
    case 'event':
      return '/api/calendar-events';
    case 'task_action_item':
      return '/api/task-action-items';
    case 'tax_legal_item':
      return '/api/tax-legal-items';
  }
}

