import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

// Simplified vehicle form schema - tasks are managed separately
const simplifiedVehicleFormSchema = z.object({
  // Essential Vehicle Info
  vehicleName: z.string().min(1, "Vehicle name is required"),
  make: z.string().min(1, "Make is required"),
  model: z.string().min(1, "Model is required"),
  year: z.string().min(4, "Year is required").regex(/^\d{4}$/, "Year must be a 4-digit number"),
  vehicleType: z.string().min(1, "Vehicle type is required"),
  registrationNumber: z.string().min(1, "Registration number is required"),
  registeredName: z.string().min(1, "Registered name is required"),
  rtoMobile: z.string().min(1, "RTO registered mobile is required"),
  rtoEmail: z.string().email("Valid email required").optional().or(z.literal("")),
  
  // Vehicle Insurance Details
  insuranceCompany: z.string().min(1, "Insurance company name is required"),
  insurancePolicyNumber: z.string().optional(),
  insuranceFromDate: z.string().min(1, "Insurance from date is required"),
  insuranceToDate: z.string().min(1, "Insurance to date is required"),
});

type SimplifiedVehicleFormData = z.infer<typeof simplifiedVehicleFormSchema>;

const vehicleTypes = [
  { value: "scooter", label: "Scooter" },
  { value: "bike", label: "Bike/Motorcycle" },
  { value: "car", label: "Car" },
  { value: "cycle", label: "Cycle" },
  { value: "truck", label: "Truck" },
  { value: "bus", label: "Bus" },
  { value: "auto", label: "Auto Rickshaw" },
  { value: "other", label: "Other" },
];

interface SimplifiedVehicleFormProps {
  onSuccess: () => void;
  onCancel: () => void;
  initialData?: any; // Vehicle data for editing
}

export function SimplifiedVehicleForm({ onSuccess, onCancel, initialData }: SimplifiedVehicleFormProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<SimplifiedVehicleFormData>({
    resolver: zodResolver(simplifiedVehicleFormSchema),
    defaultValues: {
      vehicleName: initialData?.vehicleName || '',
      make: initialData?.make || '',
      model: initialData?.model || '',
      year: initialData?.year?.toString() || '',
      vehicleType: initialData?.vehicleType || '',
      registrationNumber: initialData?.registrationNumber || '',
      registeredName: initialData?.registeredName || '',
      rtoMobile: initialData?.registeredMobile || '',
      rtoEmail: initialData?.registeredEmail || '',
      insuranceCompany: initialData?.insuranceProvider || initialData?.customFields?.insuranceCompany || '',
      insurancePolicyNumber: initialData?.insurancePolicyNumber || '',
      insuranceFromDate: initialData?.customFields?.insuranceFromDate || '',
      insuranceToDate: initialData?.customFields?.insuranceToDate || '',
    },
  });

  const createVehicleMutation = useMutation({
    mutationFn: async (data: SimplifiedVehicleFormData) => {
      // Prepare vehicle data
      const vehicleData = {
        vehicleName: data.vehicleName,
        make: data.make,
        model: data.model,
        year: parseInt(data.year),
        vehicleType: data.vehicleType,
        registrationNumber: data.registrationNumber,
        registeredName: data.registeredName,
        registeredMobile: data.rtoMobile,
        registeredEmail: data.rtoEmail || undefined,
        insuranceProvider: data.insuranceCompany,
        insurancePolicyNumber: data.insurancePolicyNumber?.trim() || null,
        // Store insurance dates in custom fields (period columns removed from schema)
        customFields: {
          insuranceFromDate: data.insuranceFromDate,
          insuranceToDate: data.insuranceToDate,
        },
      };

      // If editing, use PUT; otherwise POST
      const vehicle = initialData 
        ? await apiRequest('PUT', `/api/vehicles/${initialData.id}`, vehicleData)
        : await apiRequest('POST', '/api/vehicles', vehicleData);

      return vehicle;
    },
    onSuccess: (vehicle) => {
      queryClient.invalidateQueries({ queryKey: ["/api/vehicles"] });
      toast({ 
        title: initialData ? "Vehicle updated successfully!" : "Vehicle created successfully!", 
        description: initialData ? "Vehicle details have been updated" : "You can now add tasks for this vehicle" 
      });
      onSuccess();
    },
    onError: (error: Error) => {
      toast({ 
        title: initialData ? "Failed to update vehicle" : "Failed to create vehicle", 
        description: error.message, 
        variant: "destructive" 
      });
    },
  });

  const onSubmit = (data: SimplifiedVehicleFormData) => {
    createVehicleMutation.mutate(data);
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          
          {/* Essential Vehicle Information */}
          <div className="border rounded-sm">
            <CardHeader>
              <CardTitle>Essential Vehicle Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="vehicleName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Vehicle Name *</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-vehicle-name" placeholder="e.g., My Honda Activa" />
                      </FormControl>
                      <FormDescription className="text-xs">
                        Give your vehicle a friendly name for easy identification
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="vehicleType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Vehicle Type *</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-vehicle-type">
                            <SelectValue placeholder="Select vehicle type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {vehicleTypes.map((type) => (
                            <SelectItem key={type.value} value={type.value}>
                              {type.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="make"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Make (Brand) *</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-make" placeholder="e.g., Honda, Maruti, Tata" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="model"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Model *</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-model" placeholder="e.g., Activa 6G, Swift, Nexon" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="year"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Year *</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-year" type="number" min="1900" max="2100" placeholder="e.g., 2024" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="registrationNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Registration Number *</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-registration" placeholder="e.g., TN09AB4321" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="registeredName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Registered Name (RTO) *</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-registered-name" placeholder="e.g., John Doe" />
                      </FormControl>
                      <FormDescription className="text-xs">
                        Name as registered with RTO
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="rtoMobile"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>RTO Registered Mobile *</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-rto-mobile" placeholder="e.g., +91 9876543210" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="rtoEmail"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>RTO Registered Email (Optional)</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-rto-email" type="email" placeholder="email@example.com" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </div>

          {/* Vehicle Insurance Details */}
          <div className="border rounded-sm">
            <CardHeader>
              <CardTitle>Vehicle Insurance Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="insuranceCompany"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Insurance Company *</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-insurance-company" placeholder="e.g., ICICI Lombard" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="insurancePolicyNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Insurance Policy Number (Optional)</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-insurance-policy-number" placeholder="e.g., POLICY-123456" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="insuranceFromDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Insurance From Date *</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-insurance-from" type="date" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="insuranceToDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Insurance To Date *</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-insurance-to" type="date" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </div>

          {/* Form Actions */}
          <div className="modal-footer-actions">
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={createVehicleMutation.isPending} data-testid="button-save-vehicle">
              {createVehicleMutation.isPending 
                ? (initialData ? 'Updating...' : 'Creating...') 
                : (initialData ? 'Update Vehicle' : 'Create Vehicle')}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
