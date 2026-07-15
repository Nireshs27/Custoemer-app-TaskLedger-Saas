import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Loader2, ArrowLeft, Plus, X } from "lucide-react";
import { z } from "zod";

interface PropertyFormProps {
  mode?: "create" | "edit";
  initialData?: any;
  onSuccess: () => void;
  onCancel: () => void;
}

const propertyFormSchema = z.object({
  name: z.string().min(1, "Property name is required"),
  address: z.string().min(1, "Address is required"),
  propertyType: z.string().min(1, "Property type is required"),
  city: z.string().min(1, "City is required"),
  state: z.string().min(1, "State is required"),
  pincode: z.string().optional(),
  numberOfFloors: z.string().min(1, "Number of floors is required").refine((val) => {
    const num = parseInt(val);
    return !isNaN(num) && num >= 1 && num <= 50;
  }, "Number of floors must be between 1 and 50"),
  propertyTaxOldNumber: z.string().optional(),
  propertyTaxNewNumber: z.string().optional(),
});

type PropertyFormData = z.infer<typeof propertyFormSchema>;

export default function PropertyForm({ mode = "create", initialData, onSuccess, onCancel }: PropertyFormProps) {
  const { toast } = useToast();
  const isEditMode = mode === "edit";

  // Initialize EB numbers from initialData or default
  const initialEbNumbers = initialData?.ebNumbers 
    ? Object.entries(initialData.ebNumbers).map(([name, ebNumber]) => ({ name, ebNumber: ebNumber as string }))
    : [{ name: "Ground Floor", ebNumber: "" }];

  const [ebNumbers, setEbNumbers] = useState<{ name: string; ebNumber: string }[]>(initialEbNumbers);

  const form = useForm<PropertyFormData>({
    resolver: zodResolver(propertyFormSchema),
    defaultValues: {
      name: initialData?.name || "",
      address: initialData?.address || "",
      propertyType: initialData?.propertyType || "",
      city: initialData?.city || "",
      state: initialData?.state || "",
      pincode: initialData?.pincode || "",
      numberOfFloors: initialData?.numberOfFloors?.toString() || "1",
      propertyTaxOldNumber: initialData?.propertyTaxOldNumber || "",
      propertyTaxNewNumber: initialData?.propertyTaxNewNumber || "",
    },
  });

  // Update form when initialData changes (for edit mode)
  useEffect(() => {
    if (isEditMode && initialData) {
      form.reset({
        name: initialData.name || "",
        address: initialData.address || "",
        propertyType: initialData.propertyType || "",
        city: initialData.city || "",
        state: initialData.state || "",
        pincode: initialData.pincode || "",
        numberOfFloors: initialData.numberOfFloors?.toString() || "1",
        propertyTaxOldNumber: initialData.propertyTaxOldNumber || "",
        propertyTaxNewNumber: initialData.propertyTaxNewNumber || "",
      });
      if (initialData.ebNumbers && Object.keys(initialData.ebNumbers).length > 0) {
        setEbNumbers(
          Object.entries(initialData.ebNumbers).map(([name, ebNumber]) => ({ 
            name, 
            ebNumber: ebNumber as string 
          }))
        );
      }
    }
  }, [isEditMode, initialData, form]);

  const savePropertyMutation = useMutation({
    mutationFn: async (data: PropertyFormData) => {
      // Convert EB numbers array to JSON object
      const ebNumbersObj = ebNumbers.reduce((acc, { name, ebNumber }) => {
        if (name.trim() && ebNumber.trim()) {
          acc[name.trim()] = ebNumber.trim();
        }
        return acc;
      }, {} as Record<string, string>);

      const payload = {
        ...data,
        numberOfFloors: parseInt(data.numberOfFloors),
        ebNumbers: ebNumbersObj,
        propertyTaxOldNumber: data.propertyTaxOldNumber?.trim() || undefined,
        propertyTaxNewNumber: data.propertyTaxNewNumber?.trim() || undefined,
      };

      if (isEditMode && initialData?.id) {
        return await apiRequest("PUT", `/api/properties/${initialData.id}`, payload);
      } else {
        return await apiRequest("POST", "/api/properties", payload);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: isEditMode ? "Property updated successfully" : "Property created successfully" });
      onSuccess();
    },
    onError: (error: Error) => {
      toast({ 
        title: isEditMode ? "Failed to update property" : "Failed to create property", 
        description: error.message, 
        variant: "destructive" 
      });
    },
  });

  const propertyTypes = [
    "office",
    "residential",
    "warehouse",
    "retail",
    "industrial",
    "commercial",
    "land",
  ];

  const indianStates = [
    "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh",
    "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka",
    "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram",
    "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu",
    "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
    "Andaman and Nicobar Islands", "Chandigarh", "Dadra and Nagar Haveli and Daman and Diu",
    "Delhi", "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry"
  ];

  const onSubmit = (data: PropertyFormData) => {
    savePropertyMutation.mutate(data);
  };

  const addEbNumberField = () => {
    setEbNumbers([...ebNumbers, { name: "", ebNumber: "" }]);
  };

  const removeEbNumberField = (index: number) => {
    if (ebNumbers.length > 1) {
      setEbNumbers(ebNumbers.filter((_, i) => i !== index));
    }
  };

  const updateEbNumberName = (index: number, value: string) => {
    const updated = [...ebNumbers];
    updated[index].name = value;
    setEbNumbers(updated);
  };

  const updateEbNumber = (index: number, value: string) => {
    const updated = [...ebNumbers];
    updated[index].ebNumber = value;
    setEbNumbers(updated);
  };

  return (
    <div className="mt-4 border p-4 rounded-sm">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Property Name *</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="e.g., Mumbai Office, Residential Complex" data-testid="input-property-name" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="address"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Address *</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="Complete address of the property" data-testid="input-property-address" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="propertyType"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Property Type *</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger data-testid="select-property-type">
                      <SelectValue placeholder="Select property type" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {propertyTypes.map((type) => (
                      <SelectItem key={type} value={type}>
                        {type.charAt(0).toUpperCase() + type.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="city"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>City *</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="e.g., Mumbai, Delhi" data-testid="input-property-city" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="pincode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Pincode</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="e.g., 400001" data-testid="input-property-pincode" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name="state"
            render={({ field }) => (
              <FormItem>
                <FormLabel>State *</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger data-testid="select-property-state">
                      <SelectValue placeholder="Select state" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {indianStates.map((state) => (
                      <SelectItem key={state} value={state}>
                        {state}
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
            name="numberOfFloors"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Number of Floors *</FormLabel>
                <FormControl>
                  <Input 
                    {...field} 
                    type="number" 
                    min="1" 
                    max="50" 
                    placeholder="e.g., 3" 
                    data-testid="input-number-of-floors" 
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="propertyTaxOldNumber"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Property Tax Old Number</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Chennai Corporation old number" data-testid="input-property-tax-old" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="propertyTaxNewNumber"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Property Tax New Number</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Chennai Corporation new number" data-testid="input-property-tax-new" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="mt-6 border rounded-sm">
            <CardHeader>
              <CardTitle className="text-lg">EB Numbers</CardTitle>
              <p className="text-sm text-muted-foreground">
                Add EB connection numbers with custom names (e.g., Ground Floor, First Floor, Common Area, etc.)
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {ebNumbers.map((eb, index) => (
                <div key={index} className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="w-full sm:w-40">
                    <Input 
                      value={eb.name}
                      onChange={(e) => updateEbNumberName(index, e.target.value)}
                      placeholder="Connection Name"
                      className="text-sm"
                      data-testid={`input-eb-name-${index}`}
                    />
                  </div>
                  <div className="flex-1">
                    <Input
                      value={eb.ebNumber}
                      onChange={(e) => updateEbNumber(index, e.target.value)}
                      placeholder="EB Connection Number"
                      data-testid={`input-eb-number-${index}`}
                    />
                  </div>
                  {ebNumbers.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeEbNumberField(index)}
                      className="text-destructive hover:text-destructive"
                      data-testid={`button-remove-eb-${index}`}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              ))}
              
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addEbNumberField}
                className="w-full"
                data-testid="button-add-eb-number"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add EB Connection
              </Button>
            </CardContent>
          </div>

          <div className="modal-footer-actions">
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              data-testid="button-cancel-property"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={savePropertyMutation.isPending}
              data-testid="button-save-property"
            >
              {savePropertyMutation.isPending && (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              )}
              {isEditMode ? "Update Property" : "Create Property"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
