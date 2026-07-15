import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
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
import { useToast } from "@/hooks/use-toast";
import { 
  Calendar,
  Car,
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
import { format, isAfter } from "date-fns";
import { cn } from "@/lib/utils";
import type { Vehicle, VehicleItem } from "@shared/schema";
import { SimplifiedVehicleForm } from "@/components/forms/simplified-vehicle-form";
import { VehicleItemsDialog } from "@/components/vehicle-items-dialog";
import { queryClient } from "@/lib/queryClient";
import { EntityCardMenu } from "@/components/entity/entity-card-menu";
import { guardCardClick } from "@/lib/ui-event-guards";
import {
  optimisticDeleteVehicle,
  rollbackVehicleQueries,
  invalidateVehicleQueries,
} from "@/lib/optimistic-updates";
import { ConfirmDeleteByNameDialog } from "@/components/common/ConfirmDeleteByNameDialog";
import { getEffectiveDueDate } from "@/lib/effective-due-date";
import { buildSummary, getSummaryStatus } from "@/lib/entity-summary";
import { getSummaryBadges } from "@/lib/summary-badges";
import { EntityOverviewModal } from "@/components/overview/EntityOverviewModal";

export default function Vehicles() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [viewMode, setViewMode] = useState<'card' | 'list'>('card');
  const [searchQuery, setSearchQuery] = useState("");
  const [filterValue, setFilterValue] = useState("all");
  const [sortValue, setSortValue] = useState("newest");
  const [showVehicleForm, setShowVehicleForm] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState<{id: string, name: string, createdAt?: string | Date} | null>(null);
  const [vehicleToDelete, setVehicleToDelete] = useState<{id: string, name: string} | null>(null);
  const [vehicleToEdit, setVehicleToEdit] = useState<Vehicle | null>(null);
  const [overviewVehicle, setOverviewVehicle] = useState<Vehicle | null>(null);

  const { data: vehicles = [], isLoading: vehiclesLoading } = useQuery<Vehicle[]>({
    queryKey: ["/api/vehicles"],
  });

  // ✅ Vehicle items still needed for detail dialog, but not for card summaries
  const { data: vehicleItems = [], isLoading: itemsLoading } = useQuery<VehicleItem[]>({
    queryKey: ["/api/vehicle-items"],
  });

  const isLoading = vehiclesLoading || itemsLoading;

  // Delete mutation with optimistic updates (Lightning Fast!)
  const deleteVehicleMutation = useMutation({
    mutationFn: async (vehicleId: string) => {
      const response = await fetch(`/api/vehicles/${vehicleId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Failed to delete vehicle');
      }
      
      return null;
    },
    // Optimistic update - remove vehicle immediately from UI (0ms feel!)
    onMutate: async (vehicleId) => {
      // Use optimistic delete utility
      const context = await optimisticDeleteVehicle(queryClient, vehicleId);
      
      // Close confirmation dialog immediately
      setVehicleToDelete(null);
      
      return context;
    },
    onSuccess: () => {
      toast({
        title: "Vehicle Deleted",
        description: "Vehicle and all its tasks have been removed successfully",
      });
    },
    onError: (error: Error, vehicleId, context) => {
      // Rollback on error
      if (context?.previousData) {
        rollbackVehicleQueries(queryClient, context.previousData);
      }
      
      toast({
        title: "Error",
        description: error.message || "Failed to delete vehicle",
        variant: "destructive",
      });
    },
    // Always refetch to sync with server
    onSettled: () => {
      invalidateVehicleQueries(queryClient);
    },
  });

  const filterOptions = [
    { value: "all", label: "All Vehicles" },
    { value: "car", label: "Cars" },
    { value: "truck", label: "Trucks" },
    { value: "motorcycle", label: "Motorcycles" },
  ];

  const sortOptions = [
    { value: "newest", label: "Newest First" },
    { value: "make", label: "Make & Model" },
    { value: "year", label: "Year" },
    { value: "nextDue", label: "Next Due Date" },
  ];

  const combinedData = useMemo(() => {
    if (!Array.isArray(vehicles)) return [];

    // ✅ Use server-provided occurrenceSummary (single source of truth)
    return vehicles.map((vehicle: any) => {
      const summary = vehicle.occurrenceSummary || {
        itemsCount: 0,
        pendingCount: 0,
        overdueCount: 0,
        dueTodayCount: 0,
        upcomingCount: 0,
        nextDueOccurrence: null,
      };
      
      return {
        ...vehicle,
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
  }, [vehicles]);

  const filteredAndSortedVehicles = useMemo(() => {
    let filtered = combinedData;

    // Filter by search
    if (searchQuery) {
      filtered = filtered.filter(vehicle => 
        `${vehicle.make} ${vehicle.model}`.toLowerCase().includes(searchQuery.toLowerCase()) ||
        vehicle.registrationNumber?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Filter by type
    if (filterValue !== "all") {
      filtered = filtered.filter(vehicle => 
        vehicle.vehicleType.toLowerCase() === filterValue
      );
    }

    // Sort vehicles
    return [...filtered].sort((a, b) => {
      switch (sortValue) {
        case "newest":
          // Preserve server ordering (created_at DESC)
          return 0;
        case "year":
          return (b.year || 0) - (a.year || 0);
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
        case "make":
          return `${a.make} ${a.model}`.localeCompare(`${b.make} ${b.model}`);
        default:
          return 0;
      }
    });
  }, [combinedData, searchQuery, filterValue, sortValue]);

  const VehicleCard = ({ vehicle }: { vehicle: any }) => {
    const status = getSummaryStatus({
      itemsCount: vehicle.itemsCount,
      nextDueItem: vehicle.nextDueItem,
      overdueCount: vehicle.overdueCount,
      dueTodayCount: vehicle.dueTodayCount,
      upcomingCount: vehicle.upcomingCount,
      pendingCount: vehicle.pendingCount,
    });
    const StatusIcon = status.icon;
    
    return (
      <Card 
        className={cn(
          "hover:-translate-y-3 transition-all duration-300 cursor-pointer",
          status.priority === 'high' ? "border-l-red-500" :
          status.priority === 'medium' ? "border-l-yellow-500" : "border-l-blue-500"
        )}
        data-testid={`vehicle-card-${vehicle.id}`}
      >
        <CardContent className="p-5 sm:p-6 space-y-4">
          <div className="flex items-start justify-between">
            <div 
              className={cn("p-2 rounded-lg cursor-pointer", status.color)}
              onClick={(e) => {
                if (guardCardClick(e)) return;
                setSelectedVehicle({id: vehicle.id, name: `${vehicle.make} ${vehicle.model}`, createdAt: vehicle.createdAt});
              }}
            >
              <StatusIcon className="w-5 h-5" />
            </div>
            <div className="flex items-center gap-2">
              <div className="flex flex-wrap items-center justify-end gap-1.5">
                {getSummaryBadges({
                  overdueCount: vehicle.overdueCount,
                  dueTodayCount: vehicle.dueTodayCount,
                  upcomingCount: vehicle.upcomingCount,
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
                entityType="vehicle"
                entityId={vehicle.id}
                entityLabel={`${vehicle.make} ${vehicle.model} - ${vehicle.registrationNumber}`}
                onOverview={() => setOverviewVehicle(vehicle)}
                onEdit={() => setVehicleToEdit(vehicle)}
                onDelete={() => setVehicleToDelete({id: vehicle.id, name: `${vehicle.make} ${vehicle.model}`})}
                dataTestId={`vehicle-menu-${vehicle.id}`}
              />
            </div>
          </div>
          
          <div 
            className="cursor-pointer"
            onClick={(e) => {
              if (guardCardClick(e)) return;
              setSelectedVehicle({id: vehicle.id, name: `${vehicle.make} ${vehicle.model}`});
            }}
          >
            <h3 className="font-semibold text-foreground mb-1 line-clamp-2">
              {vehicle.make} {vehicle.model}
            </h3>
            <div className="flex items-center space-x-2 text-sm text-muted-foreground">
              <span>{vehicle.year}</span>
              {vehicle.registrationNumber && (
                <>
                  <span>•</span>
                  <span className="line-clamp-1">{vehicle.registrationNumber}</span>
                </>
              )}
            </div>
          </div>
          
          <div 
            className="flex items-center justify-between cursor-pointer"
            onClick={(e) => {
              if (guardCardClick(e)) return;
              setSelectedVehicle({id: vehicle.id, name: `${vehicle.make} ${vehicle.model}`});
            }}
          >
            <Badge variant="outline" className="capitalize">
              {vehicle.vehicleType}
            </Badge>
          </div>
          
          <div 
            className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm cursor-pointer"
            onClick={(e) => {
              if (guardCardClick(e)) return;
              setSelectedVehicle({id: vehicle.id, name: `${vehicle.make} ${vehicle.model}`});
            }}
          >
            <div className="flex items-center text-muted-foreground">
              <FileText className="w-4 h-4 mr-2" />
              {vehicle.itemsCount} items
            </div>
            {vehicle.createdAt && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Created</span>
                <span className="flex items-center text-muted-foreground">
                  <Calendar className="w-4 h-4 mr-2" />
                  {format(new Date(vehicle.createdAt), "MMM d, yyyy")}
                </span>
              </div>
            )}
            {vehicle.nextDueItem && (
              <div className="flex items-center text-muted-foreground">
                <Calendar className="w-4 h-4 mr-2" />
                {(() => {
                  const eff = getEffectiveDueDate(vehicle.nextDueItem as any);
                  const d = eff ?? new Date((vehicle.nextDueItem as any).dueDate as any);
                  return format(d, "MMM d");
                })()}
              </div>
            )}
          </div>
          
          {vehicle.nextDueItem && (
            <div 
              className="mt-4 pt-4 border-t border-muted text-xs text-muted-foreground bg-muted/30 rounded p-2 cursor-pointer"
              onClick={(e) => {
                if (guardCardClick(e)) return;
                setSelectedVehicle({id: vehicle.id, name: `${vehicle.make} ${vehicle.model}`, createdAt: vehicle.createdAt});
              }}
            >
              Next: {vehicle.nextDueItem.notes || vehicle.nextDueItem.title}
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
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-6 max-w-screen-2xl space-y-6" data-testid="vehicles-content">
        <Card className="text-center py-12">
          <CardContent>
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-muted-foreground">Loading vehicles...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-6 max-w-screen-2xl space-y-6" data-testid="vehicles-content">
      {/* Page Header Card */}
      <Card className="rounded-xl px-2">
        <CardContent className="p-4 sm:p-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-2xl font-bold">Vehicles</h1>
              <p className="text-muted-foreground">Manage your vehicle fleet and maintenance schedules</p>
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
              <Button onClick={() => setShowVehicleForm(true)} data-testid="button-add-vehicle">
                <Plus className="w-4 h-4 mr-2" />
                Add Vehicle
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Search Controls */}
      <Card className="rounded-2xl">
        <CardContent className="p-4 sm:p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center">
            <div className="relative flex-1 max-w-md w-full">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search vehicles..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
                data-testid="input-search-vehicles"
              />
            </div>
            <div className="filter-bar-controls">
              <Select value={filterValue} onValueChange={setFilterValue}>
                <SelectTrigger className="w-full sm:w-48" data-testid="select-filter">
                  <SelectValue placeholder="All Vehicles" />
                </SelectTrigger>
                <SelectContent>
                  {filterOptions.map(option => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={sortValue} onValueChange={setSortValue}>
                <SelectTrigger className="w-full sm:w-48" data-testid="select-sort">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  {sortOptions.map(option => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4">
        {viewMode === 'card' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredAndSortedVehicles.map((vehicle) => (
              <VehicleCard key={vehicle.id} vehicle={vehicle} />
            ))}
          </div>
        ) : (
          <Card className="rounded-xl overflow-hidden">
            <CardContent className="p-0">
              <Table className="min-w-[640px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="px-4 py-3">Vehicle</TableHead>
                    <TableHead className="px-4 py-3">Type</TableHead>
                    <TableHead className="px-4 py-3 hidden sm:table-cell">Registration</TableHead>
                    <TableHead className="px-4 py-3">Year</TableHead>
                    <TableHead className="px-4 py-3">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y">
                  {filteredAndSortedVehicles.map((vehicle) => {
                    const status = getSummaryStatus({
                      itemsCount: vehicle.itemsCount,
                      nextDueItem: vehicle.nextDueItem,
                      overdueCount: vehicle.overdueCount,
                      dueTodayCount: vehicle.dueTodayCount,
                      upcomingCount: vehicle.upcomingCount,
                      pendingCount: vehicle.pendingCount,
                    });
                    const StatusIcon = status.icon;
                    
                    return (
                      <TableRow key={vehicle.id} className="px-4 py-3" data-testid={`vehicle-row-${vehicle.id}`}>
                        <TableCell className="px-4 py-3">
                          <div className="flex items-center space-x-2">
                            <div className={cn("p-1.5 rounded-lg", status.color)}>
                              <StatusIcon className="w-4 h-4" />
                            </div>
                            <div>
                              <p className="font-medium line-clamp-1">{vehicle.make} {vehicle.model}</p>
                              <p className="text-sm text-muted-foreground">{vehicle.itemsCount} items</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="px-4 py-3 capitalize">{vehicle.vehicleType}</TableCell>
                        <TableCell className="px-4 py-3 hidden sm:table-cell">{vehicle.registrationNumber || '-'}</TableCell>
                        <TableCell className="px-4 py-3">{vehicle.year}</TableCell>
                        <TableCell className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {getSummaryBadges({
                              overdueCount: vehicle.overdueCount,
                              dueTodayCount: vehicle.dueTodayCount,
                              upcomingCount: vehicle.upcomingCount,
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

        {filteredAndSortedVehicles.length === 0 && (
          <Card className="text-center py-12">
            <CardContent>
              <Car className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">No vehicles found</h3>
              <p className="text-muted-foreground mb-4">
                {searchQuery || filterValue !== "all" 
                  ? "Try adjusting your search or filter criteria." 
                  : "Get started by adding your first vehicle."}
              </p>
              <Button onClick={() => setShowVehicleForm(true)} data-testid="button-add-first-vehicle">
                <Plus className="w-4 h-4 mr-2" />
                Add Vehicle
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Enhanced Vehicle Form Dialog - Comprehensive Vehicle Creation with Advanced Scheduling */}
      <Dialog open={showVehicleForm} onOpenChange={setShowVehicleForm}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto" aria-describedby="vehicle-form-description">
          <DialogHeader>
            <DialogTitle className="flex items-center space-x-2">
              <Car className="w-5 h-5" />
              <span>Add Vehicle</span>
            </DialogTitle>
            <div id="vehicle-form-description" className="text-sm text-muted-foreground">
              Create vehicle records with essential details, insurance information, and document management.
            </div>
          </DialogHeader>
          <div className="mt-4">
            <SimplifiedVehicleForm
              onSuccess={() => setShowVehicleForm(false)}
              onCancel={() => setShowVehicleForm(false)}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* Vehicle Items Dialog - View and manage vehicle tasks */}
      {selectedVehicle && (
        <VehicleItemsDialog
          open={!!selectedVehicle}
          onOpenChange={(open) => !open && setSelectedVehicle(null)}
          vehicleId={selectedVehicle.id}
          vehicleName={selectedVehicle.name}
          createdAt={selectedVehicle.createdAt}
        />
      )}

      {/* Delete Confirmation Dialog - Type to Confirm */}
      <ConfirmDeleteByNameDialog
        open={!!vehicleToDelete}
        onClose={() => setVehicleToDelete(null)}
        entityLabel="Vehicle"
        entityName={vehicleToDelete?.name ?? ""}
        onConfirm={async () => {
          if (!vehicleToDelete) return;
          await deleteVehicleMutation.mutateAsync(vehicleToDelete.id);
        }}
      />

      {/* Edit Vehicle Dialog */}
      {vehicleToEdit && (
        <Dialog open={!!vehicleToEdit} onOpenChange={(open) => !open && setVehicleToEdit(null)}>
          <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto" data-testid="modal-edit-vehicle">
            <DialogHeader>
              <DialogTitle className="flex items-center space-x-2">
                <Edit className="w-5 h-5" />
                <span>Edit Vehicle</span>
              </DialogTitle>
              {vehicleToEdit?.createdAt && (
                <div className="flex items-center text-sm text-muted-foreground mt-1">
                  <Calendar className="w-4 h-4 mr-2" />
                  <span>Created: {format(new Date(vehicleToEdit.createdAt), "MMM d, yyyy")}</span>
                </div>
              )}
              <DialogDescription className="sr-only">
                Form to create or edit this item.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4">
              <SimplifiedVehicleForm
                initialData={vehicleToEdit}
                onSuccess={() => setVehicleToEdit(null)}
                onCancel={() => setVehicleToEdit(null)}
              />
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Overview Modal */}
      {overviewVehicle && (
        <EntityOverviewModal
          open={!!overviewVehicle}
          onOpenChange={(open) => !open && setOverviewVehicle(null)}
          entityType="vehicle"
          entityId={overviewVehicle.id}
          entityLabel={`${overviewVehicle.make} ${overviewVehicle.model}`}
          entitySummary={{
            make: overviewVehicle.make,
            model: overviewVehicle.model,
            year: overviewVehicle.year,
            vehicleType: overviewVehicle.vehicleType,
            registrationNumber: overviewVehicle.registrationNumber || "N/A",
            vin: overviewVehicle.vin || "N/A",
            notes: overviewVehicle.notes || "No notes",
            createdAt: overviewVehicle.createdAt ? format(new Date(overviewVehicle.createdAt), "MMM d, yyyy") : "Unknown",
          }}
        />
      )}
    </div>
  );
}