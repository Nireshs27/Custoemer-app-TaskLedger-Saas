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
import { useState } from "react";
import type { Asset } from "@shared/schema";

const simplifiedAssetFormSchema = z.object({
  assetName: z.string().min(1, "Asset name is required"),
  assetType: z.string().min(1, "Asset type is required"),
  serialNumber: z.string().optional(),
  firmName: z.string().min(1, "Firm/Individual name is required"),
  purchaseDate: z.string().min(1, "Purchase date is required"),
  purchaseAmount: z.string().optional(),
  depreciationPercent: z.string().optional(),
  depreciationMethod: z.string().optional(),
});

export type SimplifiedAssetFormData = z.infer<typeof simplifiedAssetFormSchema>;

const assetTypes = [
  { value: "electronics", label: "Electronics" },
  { value: "furniture", label: "Furniture" },
  { value: "security", label: "Security" },
  { value: "machinery", label: "Machinery" },
  { value: "equipment", label: "Equipment" },
  { value: "tools", label: "Tools" },
  { value: "other", label: "Other" },
];

const depreciationMethods = [
  { value: "straight-line", label: "Straight Line Method" },
  { value: "written-down", label: "Written Down Value (WDV)" },
  { value: "double-declining", label: "Double Declining Balance" },
  { value: "sum-of-years", label: "Sum of Years' Digits" },
  { value: "units-of-production", label: "Units of Production" },
];

interface SimplifiedAssetFormProps {
  onSuccess: () => void;
  onCancel: () => void;
  initialData?: Asset | null;
  /**
   * Optional create handler to enable optimistic updates from the parent.
   * If not provided, the form will use its internal mutation and invalidate queries.
   */
  onCreate?: (data: SimplifiedAssetFormData) => Promise<unknown>;
}

const toYmd = (value: any): string => {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
};

export function SimplifiedAssetForm({
  onSuccess,
  onCancel,
  onCreate,
  initialData,
}: SimplifiedAssetFormProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isExternalSubmitting, setIsExternalSubmitting] = useState(false);

  const form = useForm<SimplifiedAssetFormData>({
    resolver: zodResolver(simplifiedAssetFormSchema),
    defaultValues: {
      assetName: initialData?.name || "",
      assetType: initialData?.assetType || "",
      serialNumber: initialData?.serialNumber || "",
      firmName: initialData?.boughtUnder || "",
      purchaseDate: toYmd((initialData as any)?.purchaseDate),
      purchaseAmount: initialData?.purchaseAmount ? String(initialData.purchaseAmount) : "",
      depreciationPercent: initialData?.depreciationPercent ? String(initialData.depreciationPercent) : "",
      depreciationMethod: initialData?.depreciationMethod || "",
    },
  });

  const saveAssetMutation = useMutation({
    mutationFn: async (data: SimplifiedAssetFormData) => {
      const purchaseAmount = data.purchaseAmount ? parseFloat(data.purchaseAmount) : undefined;
      const depreciationPercent = data.depreciationPercent
        ? parseFloat(data.depreciationPercent)
        : undefined;

      const assetData = {
        name: data.assetName,
        assetType: data.assetType,
        serialNumber: data.serialNumber || null,
        purchaseDate: data.purchaseDate,
        purchaseAmount,
        boughtUnder: data.firmName,
        depreciationPercent: depreciationPercent ?? null,
        depreciationMethod: data.depreciationMethod || null,
      };

      const asset = initialData?.id
        ? await apiRequest("PUT", `/api/assets/${initialData.id}`, assetData)
        : await apiRequest("POST", "/api/assets", assetData);
      return { asset };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/assets"] });
      toast({
        title: initialData?.id ? "Asset updated successfully!" : "Asset created successfully!",
        description: initialData?.id ? "Asset record updated" : "Asset record created",
      });
      onSuccess();
    },
    onError: (error: Error) => {
      toast({
        title: initialData?.id ? "Failed to update asset" : "Failed to create asset",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const onSubmit = async (data: SimplifiedAssetFormData) => {
    if (onCreate && !initialData?.id) {
      try {
        setIsExternalSubmitting(true);
        await onCreate(data);
        onSuccess();
      } catch (error: any) {
        toast({
          title: "Failed to create asset",
          description: error?.message || "Please try again",
          variant: "destructive",
        });
      } finally {
        setIsExternalSubmitting(false);
      }
      return;
    }

    saveAssetMutation.mutate(data);
  };

  // Document upload UI removed until persistence is implemented

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <div className="border rounded-sm">
            <CardHeader>
              <CardTitle>Essential Asset Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="assetName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Asset Name *</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-asset-name" placeholder="e.g., CNC Machine, Generator" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
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
                  name="serialNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Serial Number</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-serial-number" placeholder="e.g., SN-260110-010" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="firmName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Bought Under (Firm/Individual) *</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-firm-name" placeholder="e.g., ABC Pvt Ltd or John Doe" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="purchaseDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Date of Purchase *</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-purchase-date" type="date" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="purchaseAmount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Purchase Amount</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-purchase-amount" type="number" placeholder="e.g., 500000" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </div>

          <div className="border rounded-sm">
            <CardHeader>
              <CardTitle>Depreciation Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="depreciationPercent"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Depreciation %</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-depreciation-percent" type="number" step="0.01" placeholder="e.g., 15" />
                      </FormControl>
                      <FormDescription>Annual depreciation percentage</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="depreciationMethod"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Method of Depreciation</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-depreciation-method">
                            <SelectValue placeholder="Select depreciation method" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {depreciationMethods.map((method) => (
                            <SelectItem key={method.value} value={method.value}>
                              {method.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </div>

          <div className="modal-footer-actions">
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={saveAssetMutation.isPending || isExternalSubmitting} data-testid="button-save-asset">
              {saveAssetMutation.isPending || isExternalSubmitting
                ? initialData?.id
                  ? "Updating..."
                  : "Creating..."
                : initialData?.id
                  ? "Update Asset"
                  : "Create Asset"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}


