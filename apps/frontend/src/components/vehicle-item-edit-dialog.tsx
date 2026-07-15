import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { VehicleItemCreateDialog } from "@/components/vehicle-item-create-dialog";
import { mapOneTimeTaskToForm } from "@/lib/vehicle-item-mappers";

interface VehicleItemEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicleItemId: string;
  onSuccess?: () => void;
}

/**
 * ✅ Edit Dialog - Thin wrapper that reuses the Create Dialog
 * TRUE DRY: Single source of truth for all vehicle task forms
 */
export function VehicleItemEditDialog({
  open,
  onOpenChange,
  vehicleItemId,
  onSuccess,
}: VehicleItemEditDialogProps) {
  // ✅ Fetch vehicle item details
  const { data: vehicleItem, isLoading, error } = useQuery({
    queryKey: ["/api/vehicle-items", vehicleItemId],
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/vehicle-items/${vehicleItemId}`);
      console.log("Fetched vehicle item for edit:", response);
      return response;
    },
    enabled: open && !!vehicleItemId,
    retry: 1,
  });

  // ✅ Helper function to parse JSONB fields
  const parseJsonbArray = (field: any): string[] => {
    if (!field) return [];
    if (Array.isArray(field)) return field;
    if (typeof field === 'string') {
      try {
        const parsed = JSON.parse(field);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  };

  // ✅ Handle loading state
  if (isLoading) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <div className="flex items-center justify-center p-8">
            <p>Loading task data...</p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // ✅ Handle error state
  if (error) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <div className="p-8">
            <h3 className="text-lg font-semibold text-destructive mb-2">Error Loading Task</h3>
            <p className="text-sm text-muted-foreground mb-4">
              {error instanceof Error ? error.message : "Failed to load task data"}
            </p>
            <Button onClick={() => onOpenChange(false)}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (!vehicleItem) {
    return null;
  }

  let initialData: any;
  let oneTimeReminderState: ReturnType<
    typeof mapOneTimeTaskToForm
  >["reminderState"] | undefined;

  if (!vehicleItem.isRecurring) {
    // Pass null for primaryReminder as it's now inline in vehicleItem
    const mapping = mapOneTimeTaskToForm(vehicleItem, null);
    initialData = {
      title: mapping.values.title,
      category: mapping.values.category,
      dueDate: mapping.values.dueDate,
      description: mapping.values.description || "",
      reminderDays: mapping.values.reminderDays,
      reminderOffsetValue: mapping.values.reminderOffsetValue,
      reminderOffsetUnit: mapping.values.reminderOffsetUnit,
      reminderTimes: mapping.values.reminderTimes,
      notificationChannels: mapping.values.notificationChannels,
      emailRecipients: mapping.values.emailRecipients,
      isRecurring: false,
      recurrenceData: null,
    };
    oneTimeReminderState = mapping.reminderState;
  } else {
    initialData = {
      title: vehicleItem.title || "",
      category: vehicleItem.category || "",
      dueDate: vehicleItem.dueDate,
      description: vehicleItem.description || "",
      reminderDays: vehicleItem.reminderDays || 7,
      reminderTimes:
        parseJsonbArray(vehicleItem.reminderTimes).length > 0
          ? parseJsonbArray(vehicleItem.reminderTimes)
          : ["09:00"],
      notificationChannels:
        parseJsonbArray(vehicleItem.notificationChannels).length > 0
          ? parseJsonbArray(vehicleItem.notificationChannels)
          : ["email"],
      emailRecipients: parseJsonbArray(vehicleItem.emailRecipients),
      isRecurring: vehicleItem.isRecurring || false,
      recurrenceData: vehicleItem.recurrenceData || null,
    };
  }

  // ✅ Reuse Create Dialog with mode="edit"
  return (
    <VehicleItemCreateDialog
      mode="edit"
      editMetadataOnly={true}
      open={open}
      onOpenChange={onOpenChange}
      vehicleId={vehicleItem.vehicleId}
      vehicleName={vehicleItem.vehicle?.name || vehicleItem.vehicle?.registrationNumber || "Vehicle"}
      vehicleItemId={vehicleItemId}
      initialData={{
        ...initialData,
        custom_fields: vehicleItem.customFields || {},
      }}
      oneTimeReminderState={oneTimeReminderState}
      limitRecurringEditFields={vehicleItem.isRecurring || false}
      onSuccess={() => {
        onOpenChange(false);
        onSuccess?.();
      }}
    />
  );
}

