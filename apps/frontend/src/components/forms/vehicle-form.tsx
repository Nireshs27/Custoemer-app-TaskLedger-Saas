import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Loader2, ArrowLeft, Plus } from "lucide-react";
import { z } from "zod";
import type { Property, Vehicle } from "@shared/schema";
import { CategorySelect } from "@/components/categories/category-select";

interface VehicleFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

const vehicleFormSchema = z.object({
  vehicleName: z.string().min(1, "Vehicle name is required"),
  registrationNumber: z.string().min(1, "Registration number is required"),
  make: z.string().min(1, "Make is required"),
  model: z.string().min(1, "Model is required"),
  year: z.string().min(1, "Year is required"),
  vehicleType: z.string().min(1, "Vehicle type is required"),
  registeredName: z.string().min(1, "Registered name is required"),
  registeredMobile: z.string().min(1, "Registered mobile is required"),
  registeredEmail: z.string().email("Valid email required").optional().or(z.literal("")),
  propertyId: z.string().optional(),
});

const vehicleItemFormSchema = z.object({
  title: z.string().min(1, "Title is required"),
  category: z.string().min(1, "Category is required"),
  dueDate: z.string().min(1, "Due date is required"),
  amount: z.string().optional(),
  reminderDays: z.string().optional(),
  notes: z.string().optional(),
});

type VehicleFormData = z.infer<typeof vehicleFormSchema>;
type VehicleItemFormData = z.infer<typeof vehicleItemFormSchema>;

export default function VehicleForm({ onSuccess, onCancel }: VehicleFormProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<'vehicle' | 'item'>('vehicle');
  const [createdVehicle, setCreatedVehicle] = useState<Vehicle | null>(null);

  const { data: properties } = useQuery<Property[]>({
    queryKey: ["/api/properties"],
  });

  const vehicleForm = useForm<VehicleFormData>({
    resolver: zodResolver(vehicleFormSchema),
    defaultValues: {
      vehicleName: "",
      registrationNumber: "",
      make: "",
      model: "",
      year: "",
      vehicleType: "",
      registeredName: "",
      registeredMobile: "",
      registeredEmail: "",
      propertyId: "",
    },
  });

  const vehicleItemForm = useForm<VehicleItemFormData>({
    resolver: zodResolver(vehicleItemFormSchema),
    defaultValues: {
      title: "",
      category: "",
      dueDate: "",
      amount: "",
      reminderDays: "7",
      notes: "",
    },
  });

  const createVehicleMutation = useMutation({
    mutationFn: async (data: VehicleFormData) => {
      const payload = {
        vehicleName: data.vehicleName,
        registrationNumber: data.registrationNumber,
        make: data.make,
        model: data.model,
        year: parseInt(data.year),
        vehicleType: data.vehicleType,
        registeredName: data.registeredName,
        registeredMobile: data.registeredMobile,
        registeredEmail: data.registeredEmail || undefined,
        propertyId: data.propertyId || undefined,
      };
      return await apiRequest("POST", "/api/vehicles", payload);
    },
    onSuccess: (vehicle: Vehicle) => {
      queryClient.invalidateQueries({ queryKey: ["/api/vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      setCreatedVehicle(vehicle);
      setStep('item');
      toast({ title: "Vehicle created successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create vehicle", description: error.message, variant: "destructive" });
    },
  });

  const createVehicleItemMutation = useMutation({
    mutationFn: async (data: VehicleItemFormData) => {
      const payload = {
        ...data,
        vehicleId: createdVehicle!.id,
        amount: data.amount ? parseFloat(data.amount) : undefined,
        reminderDays: data.reminderDays ? parseInt(data.reminderDays) : 7,
      };
      return await apiRequest("POST", "/api/vehicle-items", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vehicle-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Vehicle item created successfully" });
      onSuccess();
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create vehicle item", description: error.message, variant: "destructive" });
    },
  });

  const vehicleTypes = [
    "car",
    "truck",
    "bike",
    "motorcycle",
    "bus",
    "van",
    "auto_rickshaw",
    "tempo",
    "trailer",
  ];

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 50 }, (_, i) => currentYear - i);

  const onVehicleSubmit = (data: VehicleFormData) => {
    createVehicleMutation.mutate(data);
  };

  const onVehicleItemSubmit = (data: VehicleItemFormData) => {
    createVehicleItemMutation.mutate(data);
  };

  const handleSkipItem = () => {
    onSuccess();
  };

  const handleBackToVehicle = () => {
    setStep('vehicle');
    setCreatedVehicle(null);
  };

  if (step === 'item') {
    return (
      <div>
        <div className="flex items-center space-x-4 mb-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleBackToVehicle}
            className="text-muted-foreground hover:text-foreground"
            data-testid="button-back-to-vehicle"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Vehicle
          </Button>
          <h3 className="text-lg font-medium">
            Add Vehicle Item for {createdVehicle?.registrationNumber}
          </h3>
        </div>

        <div className="bg-muted/30 p-4 rounded-lg mb-6">
          <p className="text-sm text-muted-foreground mb-2">
            Vehicle created successfully! Now add insurance, registration, or other vehicle-related items.
          </p>
          <p className="text-xs text-muted-foreground">
            You can skip this step and add items later from the dashboard.
          </p>
        </div>

        <Form {...vehicleItemForm}>
          <form onSubmit={vehicleItemForm.handleSubmit(onVehicleItemSubmit)} className="space-y-6">
            <FormField
              control={vehicleItemForm.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title *</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="e.g., Vehicle Insurance Renewal" data-testid="input-vehicle-item-title" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={vehicleItemForm.control}
              name="category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Category *</FormLabel>
                  <FormControl>
                    <CategorySelect
                      module="vehicle"
                      value={field.value}
                      onChange={field.onChange}
                      placeholder="Select category"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={vehicleItemForm.control}
                name="dueDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Due Date *</FormLabel>
                    <FormControl>
                      <Input {...field} type="date" data-testid="input-vehicle-item-due-date" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={vehicleItemForm.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amount</FormLabel>
                    <FormControl>
                      <Input {...field} type="number" step="0.01" placeholder="0.00" data-testid="input-vehicle-item-amount" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={vehicleItemForm.control}
              name="reminderDays"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reminder Days Before Due Date</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="select-vehicle-item-reminder">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="1">1 day</SelectItem>
                      <SelectItem value="3">3 days</SelectItem>
                      <SelectItem value="7">7 days</SelectItem>
                      <SelectItem value="15">15 days</SelectItem>
                      <SelectItem value="30">30 days</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={vehicleItemForm.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea {...field} placeholder="Additional notes or details..." data-testid="textarea-vehicle-item-notes" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="modal-footer-actions">
              <Button
                type="button"
                variant="outline"
                onClick={handleSkipItem}
                data-testid="button-skip-vehicle-item"
              >
                Skip for Now
              </Button>
              <Button
                type="submit"
                disabled={createVehicleItemMutation.isPending}
                data-testid="button-save-vehicle-item"
              >
                {createVehicleItemMutation.isPending && (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                )}
                Create Vehicle Item
              </Button>
            </div>
          </form>
        </Form>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center space-x-4 mb-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
          className="text-muted-foreground hover:text-foreground"
          data-testid="button-back"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
        <h3 className="text-lg font-medium">Add Vehicle</h3>
      </div>

      <Form {...vehicleForm}>
        <form onSubmit={vehicleForm.handleSubmit(onVehicleSubmit)} className="space-y-6">
          <FormField
            control={vehicleForm.control}
            name="vehicleName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Vehicle Name *</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="e.g., My Honda Activa" data-testid="input-vehicle-name" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={vehicleForm.control}
            name="registrationNumber"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Registration Number *</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="e.g., MH-01-AB-1234" data-testid="input-vehicle-registration" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={vehicleForm.control}
              name="make"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Make *</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="e.g., Maruti, Honda, Tata" data-testid="input-vehicle-make" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={vehicleForm.control}
              name="model"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Model *</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="e.g., Swift, City, Nexon" data-testid="input-vehicle-model" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={vehicleForm.control}
              name="year"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Year *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="select-vehicle-year">
                        <SelectValue placeholder="Select year" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {years.map((year) => (
                        <SelectItem key={year} value={year.toString()}>
                          {year}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={vehicleForm.control}
              name="vehicleType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Vehicle Type *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="select-vehicle-type">
                        <SelectValue placeholder="Select vehicle type" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {vehicleTypes.map((type) => (
                        <SelectItem key={type} value={type}>
                          {type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={vehicleForm.control}
              name="registeredName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Registered Name (RTO) *</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="e.g., John Doe" data-testid="input-registered-name" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={vehicleForm.control}
              name="registeredMobile"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Registered Mobile *</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="e.g., +91 9876543210" data-testid="input-registered-mobile" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={vehicleForm.control}
            name="registeredEmail"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Registered Email (Optional)</FormLabel>
                <FormControl>
                  <Input {...field} type="email" placeholder="e.g., owner@example.com" data-testid="input-registered-email" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={vehicleForm.control}
            name="propertyId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Related Property</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger data-testid="select-vehicle-property">
                      <SelectValue placeholder="Select property (optional)" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {properties?.map((property) => (
                      <SelectItem key={property.id} value={property.id}>
                        {property.name} - {property.city}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="modal-footer-actions">
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              data-testid="button-cancel-vehicle"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createVehicleMutation.isPending}
              data-testid="button-save-vehicle"
            >
              {createVehicleMutation.isPending && (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              )}
              <Plus className="w-4 h-4 mr-2" />
              Create Vehicle
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
