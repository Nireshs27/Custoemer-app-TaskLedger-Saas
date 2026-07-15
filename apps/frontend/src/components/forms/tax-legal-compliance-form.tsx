import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
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
import { CardContent, CardHeader } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Property, TaxLegalCompliance } from "@shared/schema";

const SELECT_NONE = "__none__";

const schema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  note: z.string().optional(),
  loginId: z.string().optional(),
  propertyId: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

interface TaxLegalComplianceFormProps {
  onSuccess: () => void;
  onCancel: () => void;
  initialData?: TaxLegalCompliance | null;
}

export function TaxLegalComplianceForm({
  onSuccess,
  onCancel,
  initialData,
}: TaxLegalComplianceFormProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: properties } = useQuery<Property[]>({
    queryKey: ["/api/properties"],
  });

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: initialData?.title ?? "",
      description: (initialData as any)?.description ?? "",
      note: (initialData as any)?.note ?? "",
      loginId: (initialData as any)?.loginId ?? (initialData as any)?.login_id ?? "",
      propertyId: (initialData as any)?.propertyId ?? (initialData as any)?.property_id ?? "",
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const payload = {
        title: data.title,
        description: data.description || undefined,
        note: data.note || undefined,
        loginId: data.loginId || undefined,
        propertyId: data.propertyId ? data.propertyId : undefined,
      };
      if (initialData?.id) {
        return apiRequest("PUT", `/api/tax-legal-compliances/${initialData.id}`, payload);
      }
      return apiRequest("POST", "/api/tax-legal-compliances", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tax-legal-compliances"] });
      toast({
        title: initialData?.id ? "Compliance updated" : "Compliance created",
      });
      onSuccess();
    },
    onError: (error: any) => {
      toast({
        title: "Failed to save compliance",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="space-y-6">
      <Form {...form}>
        <form onSubmit={form.handleSubmit((data) => saveMutation.mutate(data))} className="space-y-6">
          <div className="rounded-2xl border bg-white p-6 shadow-none">
            <CardHeader className="px-0 pt-0">
            </CardHeader>
            <CardContent className="space-y-4 px-0 pb-0">
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Title *</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="e.g., GST Monthly Compliance" data-testid="tax-legal-title" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Link</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Optional link" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="note"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Note</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Optional note" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="loginId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Login ID</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Optional login ID" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="propertyId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Property</FormLabel>
                    <Select
                      onValueChange={(v) => field.onChange(v === SELECT_NONE ? "" : v)}
                      value={field.value || ""}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select property (optional)" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={SELECT_NONE}>None</SelectItem>
                        {(properties ?? []).map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </div>

          <div className="modal-footer-actions">
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "Saving..." : initialData?.id ? "Update Compliance" : "Create Compliance"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}


