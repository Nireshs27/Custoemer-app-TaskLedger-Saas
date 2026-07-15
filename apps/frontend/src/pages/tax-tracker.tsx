import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import {
  optimisticDeleteTaxLegalCompliance,
  rollbackTaxLegalComplianceQueries,
  invalidateTaxLegalComplianceQueries,
} from "@/lib/optimistic-updates";
import { ConfirmDeleteByNameDialog } from "@/components/common/ConfirmDeleteByNameDialog";
import { FileText, Plus, Search, ListChecks, Calendar } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import type { Property, TaxLegalCompliance } from "@shared/schema";
import { TaxLegalItemsDialog } from "@/components/tax-legal-items-dialog";
import { TaxLegalComplianceForm } from "@/components/forms/tax-legal-compliance-form";
import { getSummaryStatus } from "@/lib/entity-summary";
import { getSummaryBadges } from "@/lib/summary-badges";
import { getEffectiveDueDate } from "@/lib/effective-due-date";
import { useCategories } from "@/hooks/use-categories";
import { EntityOverviewModal } from "@/components/overview/EntityOverviewModal";
import { EntityCardMenu } from "@/components/entity/entity-card-menu";
import { guardCardClick } from "@/lib/ui-event-guards";

export default function TaxTracker() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("__all__");
  const [showCreateCompliance, setShowCreateCompliance] = useState(false);
  const [selectedComplianceId, setSelectedComplianceId] = useState<string | null>(null);
  const [complianceToDelete, setComplianceToDelete] = useState<{ id: string; name: string } | null>(null);
  const [complianceToEdit, setComplianceToEdit] = useState<TaxLegalCompliance | null>(null);
  const [overviewComplianceId, setOverviewComplianceId] = useState<string | null>(null);

  const { data: compliances = [], isLoading } = useQuery<TaxLegalCompliance[]>({
    queryKey: ["/api/tax-legal-compliances"],
    queryFn: async () => {
      const res = await fetch("/api/tax-legal-compliances", { credentials: "include" });
      const raw = await res.json().catch(() => null);
      const list = Array.isArray(raw) ? raw : ((raw as any)?.items ?? (raw as any)?.data ?? []);
      const normalized = Array.isArray(list) ? list : [];
      return normalized as TaxLegalCompliance[];
    },
  });

  const { data: properties = [] } = useQuery<Property[]>({
    queryKey: ["/api/properties"],
  });

  const { data: categories = [] } = useCategories("tax_legal");

  const categoryMap = useMemo(() => {
    const map = new Map();
    (categories ?? []).forEach((cat) => {
      map.set(cat.id, cat.name);
    });
    return map;
  }, [categories]);

  const selectedCompliance =
    (selectedComplianceId ? compliances.find((c: any) => c.id === selectedComplianceId) : null) ?? null;

  const getPropertyName = (propertyId: any): string | null => {
    const id = typeof propertyId === "string" ? propertyId : null;
    if (!id) return null;
    const p = (properties ?? []).find((x: any) => x.id === id);
    return p?.name ? String(p.name) : null;
  };

  const getCategoryName = (categoryId: any): string | null => {
    if (!categoryId) return null;
    return categoryMap.get(categoryId) || null;
  };

  const getVehicleLikeBorderClass = (priority: "high" | "medium" | "low") =>
    priority === "high" ? "border-l-red-500" : priority === "medium" ? "border-l-yellow-500" : "border-l-blue-500";

  const deleteComplianceMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/tax-legal-compliances/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to delete compliance");
      }
      return null;
    },
    onMutate: async (id) => {
      const context = await optimisticDeleteTaxLegalCompliance(queryClient, id);
      setComplianceToDelete(null);
      return context;
    },
    onSuccess: () => {
      toast({ title: "Compliance deleted" });
    },
    onError: (error: Error, _id, context) => {
      if (context?.previousData) {
        rollbackTaxLegalComplianceQueries(queryClient, context.previousData);
      }
      toast({
        title: "Error",
        description: error.message || "Failed to delete compliance",
        variant: "destructive",
      });
    },
    onSettled: () => {
      invalidateTaxLegalComplianceQueries(queryClient);
    },
  });

  const categoryOptions = useMemo(() => {
    return ["__all__", ...(categories ?? []).map((cat) => ({ id: cat.id, name: cat.name }))];
  }, [categories]);

  const filteredCompliances = useMemo(() => {
    let filtered = compliances ?? [];
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter((c: any) =>
        String(c?.title || "").toLowerCase().includes(q) ||
        String(c?.description || "").toLowerCase().includes(q)
      );
    }
    if (categoryFilter !== "__all__") {
      filtered = filtered.filter((c: any) => {
        return c?.category === categoryFilter;
      });
    }
    return filtered;
  }, [compliances, searchQuery, categoryFilter]);

  const summariesById = useMemo(() => {
    const map = new Map();
    filteredCompliances.forEach((c: any) => {
      const occSummary = c.occurrenceSummary || {
        itemsCount: 0,
        pendingCount: 0,
        overdueCount: 0,
        dueTodayCount: 0,
        upcomingCount: 0,
        nextDueOccurrence: null,
      };
      
      const summary = {
        itemsCount: occSummary.itemsCount,
        nextDueItem: occSummary.nextDueOccurrence ? {
          title: occSummary.nextDueOccurrence.title,
          dueDate: occSummary.nextDueOccurrence.dueDateLocalYmd,
          notes: occSummary.nextDueOccurrence.notes,
        } : null,
        overdueCount: occSummary.overdueCount,
        dueTodayCount: occSummary.dueTodayCount,
        upcomingCount: occSummary.upcomingCount,
        pendingCount: occSummary.pendingCount,
      };
      
      map.set(c.id, summary);
    });
    return map;
  }, [filteredCompliances]);

  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-6 max-w-screen-2xl space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between bg-white p-4 sm:p-6 rounded-xl shadow-sm">
        <div>
          <h1 className="text-2xl font-bold">Tax & Legal Compliance</h1>
          <p className="text-muted-foreground">
            Create compliances and assign reminder-backed tasks.
          </p>
        </div>
        <Button onClick={() => setShowCreateCompliance(true)} data-testid="tax-legal-create-compliance">
          <Plus className="w-4 h-4 mr-2" />
          Add Compliance
        </Button>
      </div>

      <div className="flex flex-col md:flex-row gap-3 bg-white p-4 sm:p-6 rounded-2xl shadow-sm">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search compliances..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-full sm:w-60">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Categories</SelectItem>
            {categoryOptions
              .filter((v) => v !== "__all__")
              .map((cat: any) => (
                <SelectItem key={cat.id} value={cat.id}>
                  {cat.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-4">
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => (
              <Card key={i} className="animate-pulse">
                <CardContent className="p-6">
                  <div className="h-4 bg-gray-200 rounded mb-2" />
                  <div className="h-3 bg-gray-200 rounded mb-4 w-2/3" />
                  <div className="h-6 bg-gray-200 rounded w-1/3" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : filteredCompliances.length === 0 ? (
          <Card className="text-center py-12">
            <CardContent>
              <ListChecks className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-lg font-medium text-muted-foreground">
                {searchQuery || categoryFilter !== "__all__"
                  ? "No compliances found matching your criteria."
                  : "Start by adding your first compliance."}
              </p>
              <Button onClick={() => setShowCreateCompliance(true)} className="mt-4">
                <Plus className="w-4 h-4 mr-2" />
                Add Compliance
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredCompliances.map((c: any) => {
              const fetchedSummary = summariesById.get(c.id);
              const summary = fetchedSummary ?? {
                itemsCount: Number(c?.itemsCount ?? 0),
                pendingCount: Number(c?.pendingCount ?? 0),
                overdueCount: Number(c?.overdueCount ?? 0),
                dueTodayCount: Number(c?.dueTodayCount ?? 0),
                upcomingCount: Number(c?.upcomingCount ?? 0),
                nextDueItem: (c?.nextDueItem ?? null) as any,
              };
              const status = getSummaryStatus(summary);
              const StatusIcon = status.icon;
              const effectiveNext = summary.nextDueItem ? getEffectiveDueDate(summary.nextDueItem) : null;
              const isInactive = String(c?.status ?? "").toLowerCase() === "inactive";
              const pillText = isInactive ? "Inactive" : status.text;
              const pillPriority: "high" | "medium" | "low" = isInactive ? "medium" : status.priority;

              return (
                <Card
                  key={c.id}
                  className={cn(
                    "hover:-translate-y-1 transition-all duration-300 cursor-pointer border-l-4",
                    getVehicleLikeBorderClass(pillPriority)
                  )}
                  onClick={(e) => {
                    if (guardCardClick(e)) return;
                    setSelectedComplianceId(c.id);
                  }}
                  data-testid={`tax-legal-card-${c.id}`}
                >
                  <CardContent className="p-5 sm:p-6 space-y-4">
                    <div className="flex items-start justify-between">
                      <div className={cn("p-2 rounded-lg", status.color)}>
                        <StatusIcon className="w-5 h-5" />
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          {getSummaryBadges({
                            overdueCount: summary.overdueCount,
                            dueTodayCount: summary.dueTodayCount,
                            upcomingCount: summary.upcomingCount,
                          }).map((badge) => (
                            <Badge 
                              key={badge.key}
                              variant={badge.variant}
                              className={cn("px-2 py-0.5 text-xs font-medium", badge.className)}
                            >
                              {badge.label}
                            </Badge>
                          ))}
                        </div>

                        <EntityCardMenu
                          entityType="tax_legal_compliance"
                          entityId={c.id}
                          entityLabel={c.title}
                          onOverview={() => setOverviewComplianceId(c.id)}
                          onEdit={() => setComplianceToEdit(c)}
                          onDelete={() => setComplianceToDelete({ id: c.id, name: String(c.title ?? "") })}
                          dataTestId={`tax-legal-menu-${c.id}`}
                        />
                      </div>
                    </div>

                    <div className="min-w-0">
                      <h3 className="font-semibold text-foreground mb-1 line-clamp-2">{c.title}</h3>
                    </div>

                    <div className="space-y-2 text-sm">
                      {getCategoryName(c?.category) && (
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-muted-foreground">Category</span>
                          <span className="font-medium text-foreground truncate">
                            {getCategoryName(c.category)}
                          </span>
                        </div>
                      )}

                      {c.propertyId && getPropertyName(c.propertyId) && (
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-muted-foreground">Property</span>
                          <span className="font-medium text-foreground truncate">
                            {getPropertyName(c.propertyId)}
                          </span>
                        </div>
                      )}

                      {(c.createdAt || c.created_at) && (
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-muted-foreground">Created</span>
                          <span className="flex items-center text-muted-foreground">
                            <Calendar className="w-4 h-4 mr-2" />
                            {format(new Date(c.createdAt ?? c.created_at), "MMM d, yyyy")}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                      <div className="flex items-center text-muted-foreground">
                        <FileText className="w-4 h-4 mr-2" />
                        {summary.itemsCount} items
                      </div>
                    </div>

                    {summary.nextDueItem && (summary.nextDueItem?.notes || summary.nextDueItem?.title) && effectiveNext && (
                      <div className="mt-4 pt-4 border-t border-muted text-xs text-muted-foreground bg-muted/30 rounded p-2">
                        Next: {summary.nextDueItem?.notes || summary.nextDueItem?.title} ({format(effectiveNext, "MMM d")})
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={showCreateCompliance} onOpenChange={setShowCreateCompliance}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Tax & Legal Compliance</DialogTitle>
            <div className="text-sm text-muted-foreground">
              Track tax filings, statutory compliances, renewals, and deadlines with reminders and documentation.
            </div>
            <DialogDescription className="sr-only">
              Form to create or edit this item.
            </DialogDescription>
          </DialogHeader>
          <TaxLegalComplianceForm
            onSuccess={() => setShowCreateCompliance(false)}
            onCancel={() => setShowCreateCompliance(false)}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={!!complianceToEdit} onOpenChange={(open) => !open && setComplianceToEdit(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="modal-edit-tax-legal">
          <DialogHeader>
            <DialogTitle>Edit Compliance</DialogTitle>
            <DialogDescription className="sr-only">Form to edit this compliance.</DialogDescription>
          </DialogHeader>
          <TaxLegalComplianceForm
            initialData={complianceToEdit}
            onSuccess={() => setComplianceToEdit(null)}
            onCancel={() => setComplianceToEdit(null)}
          />
        </DialogContent>
      </Dialog>

      <ConfirmDeleteByNameDialog
        open={!!complianceToDelete}
        onClose={() => setComplianceToDelete(null)}
        entityLabel="Compliance"
        entityName={complianceToDelete?.name ?? ""}
        onConfirm={async () => {
          if (!complianceToDelete) return;
          await deleteComplianceMutation.mutateAsync(complianceToDelete.id);
        }}
      />

      {selectedCompliance && (
        <TaxLegalItemsDialog
          open={!!selectedCompliance}
          onOpenChange={(open) => !open && setSelectedComplianceId(null)}
          complianceId={selectedCompliance.id}
          complianceTitle={selectedCompliance.title}
          complianceCategory={(selectedCompliance as any).category ?? null}
          createdAt={(selectedCompliance as any).createdAt ?? (selectedCompliance as any).created_at}
        />
      )}

      {/* Overview Modal */}
      {overviewComplianceId && (() => {
        const oc = compliances.find(c => c.id === overviewComplianceId) as any;
        if (!oc) return null;
        return (
          <EntityOverviewModal
            open={!!overviewComplianceId}
            onOpenChange={(open) => !open && setOverviewComplianceId(null)}
            entityType="tax_legal_compliance"
            entityId={oc.id}
            entityLabel={oc.title}
            entitySummary={{
              title: oc.title,
              link: oc.description || "",
              note: oc.note || "",
              loginId: oc.loginId ?? oc.login_id ?? "",
              createdAt: oc.createdAt
                ? format(new Date(oc.createdAt), "MMM d, yyyy")
                : "Unknown",
            }}
          />
        );
      })()}
    </div>
  );
}
