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
import type { Property, Asset } from "@shared/schema";
import { CategorySelect } from "@/components/categories/category-select";

interface AssetFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

const assetFormSchema = z.object({
  name: z.string().min(1, "Asset name is required"),
  assetType: z.string().min(1, "Asset type is required"),
  serialNumber: z.string().optional(),
  propertyId: z.string().optional(),
  purchaseDate: z.string().optional(),
  purchaseAmount: z.string().optional(),
});

const assetItemFormSchema = z.object({
  title: z.string().min(1, "Title is required"),
  category: z.string().min(1, "Category is required"),
  dueDate: z.string().min(1, "Due date is required"),
  amount: z.string().optional(),
  reminderDays: z.string().optional(),
  notes: z.string().optional(),
});

type AssetFormData = z.infer<typeof assetFormSchema>;
type AssetItemFormData = z.infer<typeof assetItemFormSchema>;

export default function AssetForm({ onSuccess, onCancel }: AssetFormProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<'asset' | 'item'>('asset');
  const [createdAsset, setCreatedAsset] = useState<Asset | null>(null);

  const { data: properties } = useQuery<Property[]>({
    queryKey: ["/api/properties"],
  });

  const assetForm = useForm<AssetFormData>({
    resolver: zodResolver(assetFormSchema),
    defaultValues: {
      name: "",
      assetType: "",
      serialNumber: "",
      propertyId: "",
      purchaseDate: "",
      purchaseAmount: "",
    },
  });

  const assetItemForm = useForm<AssetItemFormData>({
    resolver: zodResolver(assetItemFormSchema),
    defaultValues: {
      title: "",
      category: "",
      dueDate: "",
      amount: "",
      reminderDays: "7",
      notes: "",
    },
  });

  const createAssetMutation = useMutation({
    mutationFn: async (data: AssetFormData) => {
      const payload = {
        ...data,
        propertyId: data.propertyId || undefined,
        purchaseDate: data.purchaseDate || undefined,
        purchaseAmount: data.purchaseAmount ? parseFloat(data.purchaseAmount) : undefined,
      };
      return await apiRequest("POST", "/api/assets", payload);
    },
    onSuccess: (asset: Asset) => {
      queryClient.invalidateQueries({ queryKey: ["/api/assets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      setCreatedAsset(asset);
      setStep('item');
      toast({ title: "Asset created successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create asset", description: error.message, variant: "destructive" });
    },
  });

  const createAssetItemMutation = useMutation({
    mutationFn: async (data: AssetItemFormData) => {
      const payload = {
        ...data,
        assetId: createdAsset!.id,
        amount: data.amount ? parseFloat(data.amount) : undefined,
        reminderDays: data.reminderDays ? parseInt(data.reminderDays) : 7,
      };
      return await apiRequest("POST", "/api/asset-items", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/asset-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Asset item created successfully" });
      onSuccess();
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create asset item", description: error.message, variant: "destructive" });
    },
  });

  const assetTypes = [
    "machinery",
    "equipment",
    "furniture",
    "computer",
    "vehicle_parts",
    "tools",
    "office_equipment",
    "manufacturing_equipment",
    "construction_equipment",
    "other",
  ];

  const onAssetSubmit = (data: AssetFormData) => {
    createAssetMutation.mutate(data);
  };

  const onAssetItemSubmit = (data: AssetItemFormData) => {
    createAssetItemMutation.mutate(data);
  };

  const handleSkipItem = () => {
    onSuccess();
  };

  const handleBackToAsset = () => {
    setStep('asset');
    setCreatedAsset(null);
  };

  if (step === 'item') {
    return (
      <div>
        <div className="flex items-center space-x-4 mb-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleBackToAsset}
            className="text-muted-foreground hover:text-foreground"
            data-testid="button-back-to-asset"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Asset
          </Button>
          <h3 className="text-lg font-medium">
            Add Asset Item for {createdAsset?.name}
          </h3>
        </div>

        <div className="bg-muted/30 p-4 rounded-lg mb-6">
          <p className="text-sm text-muted-foreground mb-2">
            Asset created successfully! Now add service dates, warranties, or other asset-related items.
          </p>
          <p className="text-xs text-muted-foreground">
            You can skip this step and add items later from the dashboard.
          </p>
        </div>

        <Form {...assetItemForm}>
          <form onSubmit={assetItemForm.handleSubmit(onAssetItemSubmit)} className="space-y-6">
            <FormField
              control={assetItemForm.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title *</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="e.g., Annual Maintenance Service" data-testid="input-asset-item-title" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={assetItemForm.control}
              name="category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Category *</FormLabel>
                  <FormControl>
                    <CategorySelect
                      module="asset"
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
                control={assetItemForm.control}
                name="dueDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Due Date *</FormLabel>
                    <FormControl>
                      <Input {...field} type="date" data-testid="input-asset-item-due-date" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={assetItemForm.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amount</FormLabel>
                    <FormControl>
                      <Input {...field} type="number" step="0.01" placeholder="0.00" data-testid="input-asset-item-amount" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={assetItemForm.control}
              name="reminderDays"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reminder Days Before Due Date</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="select-asset-item-reminder">
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
              control={assetItemForm.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea {...field} placeholder="Additional notes or details..." data-testid="textarea-asset-item-notes" />
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
                data-testid="button-skip-asset-item"
              >
                Skip for Now
              </Button>
              <Button
                type="submit"
                disabled={createAssetItemMutation.isPending}
                data-testid="button-save-asset-item"
              >
                {createAssetItemMutation.isPending && (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                )}
                Create Asset Item
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
        <h3 className="text-lg font-medium">Add Asset/Machinery</h3>
      </div>

      <Form {...assetForm}>
        <form onSubmit={assetForm.handleSubmit(onAssetSubmit)} className="space-y-6">
          <FormField
            control={assetForm.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Asset Name *</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="e.g., CNC Machine, Office Printer, Generator" data-testid="input-asset-name" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={assetForm.control}
              name="assetType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Asset Type *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="select-asset-type">
                        <SelectValue placeholder="Select asset type" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {assetTypes.map((type) => (
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

            <FormField
              control={assetForm.control}
              name="serialNumber"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Serial Number</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="e.g., SN123456789" data-testid="input-asset-serial" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={assetForm.control}
            name="propertyId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Related Property</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger data-testid="select-asset-property">
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={assetForm.control}
              name="purchaseDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Purchase Date</FormLabel>
                  <FormControl>
                    <Input {...field} type="date" data-testid="input-asset-purchase-date" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={assetForm.control}
              name="purchaseAmount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Purchase Amount</FormLabel>
                  <FormControl>
                    <Input {...field} type="number" step="0.01" placeholder="0.00" data-testid="input-asset-purchase-amount" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="modal-footer-actions">
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              data-testid="button-cancel-asset"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createAssetMutation.isPending}
              data-testid="button-save-asset"
            >
              {createAssetMutation.isPending && (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              )}
              <Plus className="w-4 h-4 mr-2" />
              Create Asset
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
