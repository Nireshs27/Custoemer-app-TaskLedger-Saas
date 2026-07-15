import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { 
  Calendar,
  ServerCog,
  FileText,
  AlertTriangle,
  CheckCircle,
  Clock,
  Plus,
  Search,
  LayoutGrid,
  List,
  MoreVertical,
  Edit,
  Trash2,
  Eye,
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import type { Asset, AssetItem } from "@shared/schema";
import { SimplifiedAssetForm, type SimplifiedAssetFormData } from "@/components/forms/simplified-asset-form";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { VehicleItemsDialog } from "@/components/vehicle-items-dialog";
import { getEffectiveDueDate } from "@/lib/effective-due-date";
import { buildSummary, getSummaryStatus } from "@/lib/entity-summary";
import { getSummaryBadges } from "@/lib/summary-badges";
import {
  optimisticDeleteAsset,
  rollbackAssetQueries,
  invalidateAssetQueries,
} from "@/lib/optimistic-updates";
import { ConfirmDeleteByNameDialog } from "@/components/common/ConfirmDeleteByNameDialog";
import { EntityOverviewModal } from "@/components/overview/EntityOverviewModal";
import { EntityCardMenu } from "@/components/entity/entity-card-menu";
import { guardCardClick } from "@/lib/ui-event-guards";

export default function Assets() {
  const { toast } = useToast();
  const [viewMode, setViewMode] = useState<'card' | 'list'>('card');
  const [searchQuery, setSearchQuery] = useState("");
  const [filterValue, setFilterValue] = useState("all");
  const [sortValue, setSortValue] = useState("newest");
  const [showAssetForm, setShowAssetForm] = useState(false);
  const [taskDialog, setTaskDialog] = useState<{ id: string; name: string; createdAt?: string | Date } | null>(null);
  const [assetToDelete, setAssetToDelete] = useState<{ id: string; name: string } | null>(null);
  const [assetToEdit, setAssetToEdit] = useState<Asset | null>(null);
  const [overviewAsset, setOverviewAsset] = useState<Asset | null>(null);

  const { data: assets, isLoading: assetsLoading } = useQuery<Asset[]>({
    queryKey: ["/api/assets"],
  });

  const { data: assetItems, isLoading: itemsLoading } = useQuery<AssetItem[]>({
    queryKey: ["/api/asset-items"],
  });

  const isLoading = assetsLoading || itemsLoading;

  // Delete mutation with optimistic updates (Lightning Fast!)
  const deleteAssetMutation = useMutation({
    mutationFn: async (assetId: string) => {
      const response = await fetch(`/api/assets/${assetId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || "Failed to delete asset");
      }
      return null;
    },
    onMutate: async (assetId) => {
      const context = await optimisticDeleteAsset(queryClient, assetId);
      setAssetToDelete(null);
      setTaskDialog(null);
      return context;
    },
    onSuccess: () => {
      toast({
        title: "Asset Deleted",
        description: "Asset and all its tasks have been removed successfully",
      });
    },
    onError: (error: Error, _assetId, context) => {
      if (context?.previousData) {
        rollbackAssetQueries(queryClient, context.previousData);
      }
      toast({
        title: "Error",
        description: error.message || "Failed to delete asset",
        variant: "destructive",
      });
    },
    onSettled: () => {
      invalidateAssetQueries(queryClient);
    },
  });

  const formatINR = (value?: string | number | null) => {
    if (value === undefined || value === null || value === "") return null;
    const num = Number(value);
    if (Number.isNaN(num)) return null;
    return num.toLocaleString("en-IN");
  };

  const buildAssetPayload = (data: SimplifiedAssetFormData) => {
    const purchaseAmount = data.purchaseAmount ? parseFloat(data.purchaseAmount) : undefined;
    const depreciationPercent = data.depreciationPercent
      ? parseFloat(data.depreciationPercent)
      : undefined;

    return {
      name: data.assetName,
      assetType: data.assetType,
      serialNumber: data.serialNumber || null,
      purchaseDate: data.purchaseDate,
      purchaseAmount,
      boughtUnder: data.firmName,
      depreciationPercent: depreciationPercent ?? null,
      depreciationMethod: data.depreciationMethod || null,
    };
  };

  const createAssetMutation = useMutation({
    mutationFn: async (formData: SimplifiedAssetFormData) => {
      const assetData = buildAssetPayload(formData);
      const asset = await apiRequest("POST", "/api/assets", assetData);
      return asset as Asset;
    },
    onMutate: async (formData) => {
      const assetData = buildAssetPayload(formData);
      const tempId = `temp_${crypto.randomUUID()}`;
      const previousAssets = queryClient.getQueryData<Asset[]>(["/api/assets"]) || [];

      const tempAsset: Asset = {
        id: tempId,
        name: assetData.name,
        assetType: assetData.assetType,
        serialNumber: null,
        boughtUnder: assetData.boughtUnder ?? null,
        depreciationPercent: assetData.depreciationPercent !== null && assetData.depreciationPercent !== undefined
          ? String(assetData.depreciationPercent)
          : null,
        depreciationMethod: assetData.depreciationMethod ?? null,
        propertyId: null,
        purchaseDate: assetData.purchaseDate ? new Date(assetData.purchaseDate) as any : null,
        purchaseAmount: assetData.purchaseAmount !== null && assetData.purchaseAmount !== undefined
          ? String(assetData.purchaseAmount)
          : null,
        customFields: {} as any,
        createdBy: "",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      queryClient.setQueryData<Asset[]>(["/api/assets"], [tempAsset, ...previousAssets]);
      setShowAssetForm(false);

      return { previousAssets, tempId };
    },
    onError: (error: Error, _formData, context) => {
      if (context?.previousAssets) {
        queryClient.setQueryData(["/api/assets"], context.previousAssets);
      }
      toast({
        title: "Failed to create asset",
        description: error.message,
        variant: "destructive",
      });
    },
    onSuccess: (asset, _formData, context) => {
      if (!context?.tempId) return;
      queryClient.setQueryData<Asset[]>(["/api/assets"], (current = []) =>
        current.map((a) => (a.id === context.tempId ? asset : a))
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/assets"] });
    },
  });

  const filterOptions = [
    { value: "all", label: "All Assets" },
    { value: "equipment", label: "Equipment" },
    { value: "machinery", label: "Machinery" },
    { value: "tools", label: "Tools" },
    { value: "other", label: "Other" },
  ];

  const sortOptions = [
    { value: "newest", label: "Newest First" },
    { value: "name", label: "Name" },
    { value: "value", label: "Value" },
    { value: "nextDue", label: "Next Due Date" },
    { value: "location", label: "Serial Number" },
  ];

  const combinedData = useMemo(() => {
    if (!assets) return [];

    // ✅ Use server-provided occurrenceSummary (single source of truth)
    return assets.map((asset: any) => {
      const summary = asset.occurrenceSummary || {
        itemsCount: 0,
        pendingCount: 0,
        overdueCount: 0,
        dueTodayCount: 0,
        upcomingCount: 0,
        nextDueOccurrence: null,
      };
      
      return {
        ...asset,
        itemsCount: summary.itemsCount,
        nextDueItem: summary.nextDueOccurrence ? {
          title: summary.nextDueOccurrence.title,
          dueDate: summary.nextDueOccurrence.dueDateLocalYmd,
          notes: summary.nextDueOccurrence.notes,
        } : null,
        overdueCount: summary.overdueCount,
        dueTodayCount: summary.dueTodayCount,
        upcomingCount: summary.upcomingCount,
        pendingCount: summary.pendingCount,
      };
    });
  }, [assets]);

  const filteredAndSortedAssets = useMemo(() => {
    let filtered = combinedData;

    // Filter by search
    if (searchQuery) {
      filtered = filtered.filter(asset => 
        asset.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        asset.serialNumber?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Filter by type
    if (filterValue !== "all") {
      filtered = filtered.filter(asset => 
        asset.assetType.toLowerCase() === filterValue
      );
    }

    // Sort assets
    return [...filtered].sort((a, b) => {
      switch (sortValue) {
        case "newest":
          // Preserve server ordering (created_at DESC)
          return 0;
        case "value":
          return parseFloat(b.purchaseAmount || '0') - parseFloat(a.purchaseAmount || '0');
        case "location":
          return (a.serialNumber || "").localeCompare(b.serialNumber || "");
        case "nextDue":
          if (!a.nextDueItem && !b.nextDueItem) return 0;
          if (!a.nextDueItem) return 1;
          if (!b.nextDueItem) return -1;
        const effA = getEffectiveDueDate(a.nextDueItem);
        const effB = getEffectiveDueDate(b.nextDueItem);
        if (!effA && !effB) return 0;
        if (!effA) return 1;
        if (!effB) return -1;
        return effA.getTime() - effB.getTime();
        case "name":
          return a.name.localeCompare(b.name);
        default:
          return 0;
      }
    });
  }, [combinedData, searchQuery, filterValue, sortValue]);

  const getStatusInfo = (asset: any) => {
    return getSummaryStatus({
      itemsCount: asset.itemsCount,
      pendingCount: asset.pendingCount,
      overdueCount: asset.overdueCount,
      dueTodayCount: asset.dueTodayCount,
      upcomingCount: asset.upcomingCount,
      nextDueItem: asset.nextDueItem,
    });
  };

  const AssetCard = ({ asset }: { asset: any }) => {
    const status = getStatusInfo(asset);
    const StatusIcon = status.icon;
    
    return (
      <Card 
        className={cn(
          "hover:-translate-y-3 transition-all duration-300 cursor-pointer",
          status.priority === 'high' ? "border-l-red-500" :
          status.priority === 'medium' ? "border-l-yellow-500" : "border-l-blue-500"
        )}
        data-testid={`asset-card-${asset.id}`}
        role="button"
        tabIndex={0}
        onClick={(e) => {
          if (guardCardClick(e)) return;
          setTaskDialog({ id: asset.id, name: asset.name, createdAt: asset.createdAt });
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setTaskDialog({ id: asset.id, name: asset.name, createdAt: asset.createdAt });
          }
        }}
      >
        <CardContent className="p-5 sm:p-6 space-y-4">
          <div className="flex items-start justify-between">
            <div className={cn("p-2 rounded-lg", status.color)}>
              <StatusIcon className="w-5 h-5" />
            </div>
            <div className="flex items-center gap-2">
              <div className="flex flex-wrap items-center justify-end gap-1.5">
                {getSummaryBadges({
                  overdueCount: asset.overdueCount,
                  dueTodayCount: asset.dueTodayCount,
                  upcomingCount: asset.upcomingCount,
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
                entityType="asset"
                entityId={asset.id}
                entityLabel={asset.name}
                onOverview={() => setOverviewAsset(asset)}
                onEdit={() => {
                  setTaskDialog(null);
                  setAssetToEdit(asset);
                }}
                onDelete={() => {
                  setTaskDialog(null);
                  setAssetToDelete({ id: asset.id, name: asset.name });
                }}
                dataTestId={`asset-menu-${asset.id}`}
              />
            </div>
          </div>
          
          <div>
            <h3 className="font-semibold text-foreground mb-1 line-clamp-2">{asset.name}</h3>
            {asset.serialNumber && (
              <p className="text-sm text-muted-foreground line-clamp-1">SN: {asset.serialNumber}</p>
            )}
          </div>
          
          <div className="flex items-center justify-between">
            <Badge variant="outline" className="capitalize">
              {asset.assetType}
            </Badge>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div className="flex items-center text-muted-foreground">
              <FileText className="w-4 h-4 mr-2" />
              {asset.itemsCount} items
            </div>
            {asset.createdAt && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Created</span>
                <span className="flex items-center text-muted-foreground">
                  <Calendar className="w-4 h-4 mr-2" />
                  {format(new Date(asset.createdAt), "MMM d, yyyy")}
                </span>
              </div>
            )}
            {asset.purchaseAmount && (
              <div className="flex items-center text-muted-foreground font-medium">
              <span className="font-medium">
                ₹{formatINR(asset.purchaseAmount)}
              </span>
              </div>
            )}
          </div>
          
          {asset.nextDueItem && (
            <div className="mt-4 pt-4 border-t border-muted text-xs text-muted-foreground bg-muted/30 rounded p-2">
              Next: {asset.nextDueItem.notes || asset.nextDueItem.title} ({format(getEffectiveDueDate(asset.nextDueItem) ?? new Date(asset.nextDueItem.dueDate as any), "MMM d")})
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  const getStatusBadgeVariant = (priority: string) => {
    switch (priority) {
      case 'high': return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300';
      case 'medium': return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300';
      default: return 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300';
    }
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-6 max-w-screen-2xl space-y-6" data-testid="assets-content">
        <Card className="text-center py-12">
          <CardContent>
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-muted-foreground">Loading assets...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-6 max-w-screen-2xl space-y-6" data-testid="assets-content">
      {/* Page Header Card */}
      <Card className="rounded-xl px-2">
        <CardContent className="p-4 sm:p-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-2xl font-bold">Assets & Machinery</h1>
              <p className="text-muted-foreground">Manage your business assets and equipment</p>
            </div>
            <div className="flex items-center space-x-4">
              <div className="flex bg-muted rounded-lg p-1">
                <Button
                  variant={viewMode === 'card' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setViewMode('card')}
                  className="px-3"
                  data-testid="view-card"
                >
                  <LayoutGrid className="w-4 h-4" />
                </Button>
                <Button
                  variant={viewMode === 'list' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setViewMode('list')}
                  className="px-3"
                  data-testid="view-list"
                >
                  <List className="w-4 h-4" />
                </Button>
              </div>
              <Button data-testid="button-add-asset" onClick={() => setShowAssetForm(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Add Asset
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Search and Filter Controls */}
      <Card className="rounded-2xl">
        <CardContent className="p-4 sm:p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:space-x-4">
            <div className="relative flex-1 max-w-md w-full">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search assets..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
                data-testid="input-search-assets"
              />
            </div>
            <div className="filter-bar-controls">
              <Select value={filterValue} onValueChange={setFilterValue}>
                <SelectTrigger className="w-full sm:w-40" data-testid="select-filter-assets">
                  <SelectValue placeholder="All Assets" />
                </SelectTrigger>
                <SelectContent>
                  {filterOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={sortValue} onValueChange={setSortValue}>
                <SelectTrigger className="w-full sm:w-40" data-testid="select-sort-assets">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  {sortOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4">
            {viewMode === 'card' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
                {filteredAndSortedAssets.map((asset) => (
                  <AssetCard key={asset.id} asset={asset} />
                ))}
              </div>
            ) : (
              <Card className="rounded-xl overflow-hidden">
                <CardContent className="p-0">
                  <Table className="min-w-[720px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="px-4 py-3">Asset</TableHead>
                        <TableHead className="px-4 py-3">Type</TableHead>
                        <TableHead className="px-4 py-3">Purchase Date</TableHead>
                        <TableHead className="px-4 py-3">Value</TableHead>
                        <TableHead className="px-4 py-3">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody className="divide-y">
                      {filteredAndSortedAssets.map((asset) => {
                        const status = getStatusInfo(asset);
                        const StatusIcon = status.icon;
                        
                        return (
                      <TableRow
                        key={asset.id}
                        className="px-4 py-3 cursor-pointer hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                        data-testid={`asset-row-${asset.id}`}
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          if (guardCardClick(e)) return;
                          setTaskDialog({ id: asset.id, name: asset.name, createdAt: asset.createdAt });
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setTaskDialog({ id: asset.id, name: asset.name, createdAt: asset.createdAt });
                          }
                        }}
                      >
                            <TableCell className="px-4 py-3">
                              <div className="flex items-center space-x-2">
                                <div className={cn("p-1.5 rounded-lg", status.color)}>
                                  <StatusIcon className="w-4 h-4" />
                                </div>
                                <div>
                                  <p className="font-medium line-clamp-1">{asset.name}</p>
                                  <p className="text-sm text-muted-foreground">{asset.itemsCount} items</p>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="px-4 py-3 capitalize">{asset.assetType}</TableCell>
                            <TableCell className="px-4 py-3">{asset.purchaseDate ? format(new Date(asset.purchaseDate), 'MMM d, yyyy') : '-'}</TableCell>
                            <TableCell className="px-4 py-3 font-medium">
                              {asset.purchaseAmount && formatINR(asset.purchaseAmount) ? `₹${formatINR(asset.purchaseAmount)}` : '-'}
                            </TableCell>
                            <TableCell className="px-4 py-3">
                              <div className="flex flex-wrap items-center gap-1.5">
                                {getSummaryBadges({
                                  overdueCount: asset.overdueCount,
                                  dueTodayCount: asset.dueTodayCount,
                                  upcomingCount: asset.upcomingCount,
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
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}

        {filteredAndSortedAssets.length === 0 && (
          <Card className="text-center py-12">
            <CardContent>
              <ServerCog className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">No assets found</h3>
              <p className="text-muted-foreground mb-4">
                {searchQuery || filterValue !== "all" 
                  ? "Try adjusting your search or filter criteria." 
                  : "Get started by adding your first asset."}
              </p>
              <Button data-testid="button-add-first-asset" onClick={() => setShowAssetForm(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Add Asset
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {taskDialog && (
          <VehicleItemsDialog
            open={!!taskDialog}
            onOpenChange={(open) => {
              if (!open) setTaskDialog(null);
            }}
            vehicleId={taskDialog.id}
            vehicleName={taskDialog.name}
            createdAt={taskDialog.createdAt}
            entityKind="asset"
          />
      )}

      {/* Asset Form Dialog */}
      <Dialog open={showAssetForm} onOpenChange={setShowAssetForm}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto" aria-describedby="asset-form-description">
          <DialogHeader>
            <DialogTitle className="flex items-center space-x-2">
              <ServerCog className="w-5 h-5" />
              <span>Add Asset & Machinery</span>
            </DialogTitle>
            <div id="asset-form-description" className="text-sm text-muted-foreground">
              Manage asset records, warranties, maintenance schedules, and related documents in one place.
            </div>
          </DialogHeader>
          <div className="mt-4">
            <SimplifiedAssetForm
              onCreate={(data) => createAssetMutation.mutateAsync(data)}
              onSuccess={() => setShowAssetForm(false)}
              onCancel={() => setShowAssetForm(false)}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog - Type to Confirm */}
      <ConfirmDeleteByNameDialog
        open={!!assetToDelete}
        onClose={() => setAssetToDelete(null)}
        entityLabel="Asset"
        entityName={assetToDelete?.name ?? ""}
        onConfirm={async () => {
          if (!assetToDelete) return;
          await deleteAssetMutation.mutateAsync(assetToDelete.id);
        }}
      />

      {/* Edit Asset Dialog */}
      {assetToEdit && (
        <Dialog open={!!assetToEdit} onOpenChange={(open) => !open && setAssetToEdit(null)}>
          <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto" data-testid="modal-edit-asset">
            <DialogHeader>
              <DialogTitle className="flex items-center space-x-2">
                <Edit className="w-5 h-5" />
                <span>Edit Asset</span>
              </DialogTitle>
              {assetToEdit?.createdAt && (
                <div className="flex items-center text-sm text-muted-foreground mt-1">
                  <Calendar className="w-4 h-4 mr-2" />
                  <span>Created: {format(new Date(assetToEdit.createdAt), "MMM d, yyyy")}</span>
                </div>
              )}
              <DialogDescription className="sr-only">
                Form to create or edit this item.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4">
              <SimplifiedAssetForm
                initialData={assetToEdit}
                onSuccess={() => setAssetToEdit(null)}
                onCancel={() => setAssetToEdit(null)}
              />
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Overview Modal */}
      {overviewAsset && (
        <EntityOverviewModal
          open={!!overviewAsset}
          onOpenChange={(open) => !open && setOverviewAsset(null)}
          entityType="asset"
          entityId={overviewAsset.id}
          entityLabel={overviewAsset.name}
          entitySummary={{
            name: overviewAsset.name,
            assetType: overviewAsset.assetType,
            make: overviewAsset.make || "N/A",
            model: overviewAsset.model || "N/A",
            serialNumber: overviewAsset.serialNumber || "N/A",
            notes: overviewAsset.notes || "No notes",
            createdAt: overviewAsset.createdAt ? format(new Date(overviewAsset.createdAt), "MMM d, yyyy") : "Unknown",
          }}
        />
      )}
    </div>
  );
}
