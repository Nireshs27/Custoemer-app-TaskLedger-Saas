import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConfirmDeleteByNameDialog } from "@/components/common/ConfirmDeleteByNameDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import PropertyForm from "@/components/forms/property-form";
import PropertyDocumentsTab from "@/components/property/PropertyDocumentsTab";
import { 
  Building,
  Home,
  Warehouse,
  MapPin,
  Plus,
  Search,
  LayoutGrid,
  List,
  MoreVertical,
  Pencil,
  Trash2,
  Calendar,
  FileText,
  Eye,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Property } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { EntityOverviewModal } from "@/components/overview/EntityOverviewModal";
import { EntityCardMenu } from "@/components/entity/entity-card-menu";
import { guardCardClick } from "@/lib/ui-event-guards";

export default function Properties() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [viewMode, setViewMode] = useState<'card' | 'list'>('card');
  const [searchQuery, setSearchQuery] = useState("");
  const [filterValue, setFilterValue] = useState("all");
  const [sortValue, setSortValue] = useState("newest");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingProperty, setEditingProperty] = useState<Property | null>(null);
  const [deletingProperty, setDeletingProperty] = useState<{ id: string; name: string } | null>(null);
  const [overviewProperty, setOverviewProperty] = useState<Property | null>(null);

  const { data: properties, isLoading } = useQuery<Property[]>({
    queryKey: ["/api/properties"],
  });

  const filterOptions = [
    { value: "all", label: "All Properties" },
    { value: "residential", label: "Residential" },
    { value: "commercial", label: "Commercial" },
    { value: "office", label: "Office" },
    { value: "warehouse", label: "Warehouse" },
  ];

  const sortOptions = [
    { value: "newest", label: "Newest First" },
    { value: "address", label: "Address" },
    { value: "propertyType", label: "Type" },
    { value: "city", label: "City" },
    { value: "name", label: "Name" },
  ];

  const filteredAndSortedProperties = useMemo(() => {
    if (!properties) return [];

    let filtered = properties;

    // Filter by search
    if (searchQuery) {
      const q = searchQuery.trim().toLowerCase();
      filtered = filtered.filter(property => 
        String(property.name ?? "").toLowerCase().includes(q) ||
        String(property.address ?? "").toLowerCase().includes(q) ||
        String(property.city ?? "").toLowerCase().includes(q) ||
        String(property.state ?? "").toLowerCase().includes(q) ||
        String(property.pincode ?? "").toLowerCase().includes(q)
      );
    }

    // Filter by type
    if (filterValue !== "all") {
      filtered = filtered.filter(property => 
        property.propertyType.toLowerCase() === filterValue
      );
    }

    // Sort properties
    return [...filtered].sort((a, b) => {
      switch (sortValue) {
        case "newest":
          // Preserve server ordering (created_at DESC)
          return 0;
        case "propertyType":
          return (a.propertyType || "").localeCompare(b.propertyType || "");
        case "city":
          return (a.city || "").localeCompare(b.city || "");
        case "name":
          return (a.name || "").localeCompare(b.name || "");
        case "address":
          return a.address.localeCompare(b.address);
        default:
          return 0;
      }
    });
  }, [properties, searchQuery, filterValue, sortValue]);

  const getPropertyIcon = (propertyType: string) => {
    switch (propertyType.toLowerCase()) {
      case 'office':
      case 'commercial':
        return Building;
      case 'residential':
        return Home;
      case 'warehouse':
        return Warehouse;
      default:
        return Building;
    }
  };

  const getPropertyColor = (propertyType: string) => {
    switch (propertyType.toLowerCase()) {
      case 'residential': return 'bg-green-50 text-green-700';
      case 'commercial': return 'bg-blue-50 text-blue-700';
      case 'office': return 'bg-purple-50 text-purple-700';
      case 'warehouse': return 'bg-orange-50 text-orange-700';
      default: return 'bg-gray-50 text-gray-700';
    }
  };

  const deletePropertyMutation = useMutation({
    mutationFn: async (propertyId: string) => {
      await apiRequest("DELETE", `/api/properties/${propertyId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Property deleted successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete property", description: error.message, variant: "destructive" });
    },
  });

  const handleEdit = (property: Property) => {
    setEditingProperty(property);
  };

  const handleDelete = (property: Property) => {
    setDeletingProperty({ id: property.id, name: property.name });
  };

  const PropertyCard = ({ property }: { property: Property }) => {
    const PropertyIcon = getPropertyIcon(property.propertyType);
    
    return (
      <Card 
        className="hover:-translate-y-3 transition-all duration-300 cursor-pointer"
        data-testid={`property-card-${property.id}`}
        onClick={(e) => {
          if (guardCardClick(e)) return;
          handleEdit(property);
        }}
      >
        <CardContent className="p-5 sm:p-6 space-y-4">
          <div className="flex items-start justify-between">
            <div className={cn("p-3 rounded-lg", getPropertyColor(property.propertyType))}>
              <PropertyIcon className="w-6 h-6" />
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className={`${getPropertyColor(property.propertyType)} px-2.5 py-0.5 text-xs font-medium capitalize`}>
                {property.propertyType}
              </Badge>
              <EntityCardMenu
                entityType="property"
                entityId={property.id}
                entityLabel={property.name}
                onOverview={() => setOverviewProperty(property)}
                onEdit={() => handleEdit(property)}
                onDelete={() => handleDelete(property)}
                dataTestId={`property-kebab-${property.id}`}
              />
            </div>
          </div>
          
          <div>
            <h3 className="font-semibold text-foreground mb-2 line-clamp-2">{property.name}</h3>
            <p className="text-sm text-muted-foreground line-clamp-2">{property.address}</p>
          </div>
          
          <div className="space-y-2 text-sm">
            <div className="flex items-center text-muted-foreground">
              <MapPin className="w-4 h-4 mr-2 flex-shrink-0" />
              <span>{property.city}, {property.state}</span>
            </div>
            {property.pincode && (
              <p className="text-xs text-muted-foreground">Pincode: {property.pincode}</p>
            )}
            {property.createdAt && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Created</span>
                <span className="flex items-center text-muted-foreground">
                  <Calendar className="w-4 h-4 mr-2" />
                  {format(new Date(property.createdAt), "MMM d, yyyy")}
                </span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  const getTypeBadgeVariant = (propertyType: string) => {
    switch (propertyType.toLowerCase()) {
      case 'residential': return 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300';
      case 'commercial': return 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300';
      case 'office': return 'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300';
      case 'warehouse': return 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300';
      default: return 'bg-gray-100 dark:bg-gray-900/30 text-gray-800 dark:text-gray-300';
    }
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-6 max-w-screen-2xl">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-6 max-w-screen-2xl space-y-6" data-testid="properties-content">
          {/* Page Header Card */}
          <Card className="rounded-xl px-2">
            <CardContent className="p-4 sm:p-6">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <h1 className="text-2xl font-bold">Properties</h1>
                  <p className="text-muted-foreground">Manage your real estate portfolio</p>
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
                  <Button onClick={() => setShowAddDialog(true)} data-testid="button-add-property">
                    <Plus className="w-4 h-4 mr-2" />
                    Add Property
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Search Controls */}
          <Card className="rounded-2xl">
            <CardContent className="p-4 sm:p-6">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="relative flex-1 max-w-md w-full">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Search properties..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                    data-testid="input-search-properties"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

      {/* Content */}
      <div className="grid gap-4">
        {viewMode === 'card' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredAndSortedProperties.map((property) => (
              <PropertyCard key={property.id} property={property} />
            ))}
          </div>
        ) : (
          <Card className="rounded-xl overflow-hidden">
            <CardContent className="p-0">
              <Table className="min-w-[720px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="px-4 py-3">Property</TableHead>
                    <TableHead className="px-4 py-3">Type</TableHead>
                    <TableHead className="px-4 py-3">Location</TableHead>
                    <TableHead className="px-4 py-3">Address</TableHead>
                    <TableHead className="px-4 py-3 w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y">
                  {filteredAndSortedProperties.map((property) => {
                    const PropertyIcon = getPropertyIcon(property.propertyType);
                    return (
                      <TableRow key={property.id} className="px-4 py-3" data-testid={`property-row-${property.id}`}>
                        <TableCell className="px-4 py-3">
                          <div className="flex items-center space-x-3">
                            <div className={cn("p-2 rounded-lg", getPropertyColor(property.propertyType))}>
                              <PropertyIcon className="w-4 h-4" />
                            </div>
                            <div>
                              <p className="font-medium line-clamp-1">{property.name}</p>
                              <p className="text-sm text-muted-foreground">{property.city}, {property.state}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="px-4 py-3">
                          <Badge className={cn("px-2.5 py-0.5 text-xs font-medium", getTypeBadgeVariant(property.propertyType))}>
                            {property.propertyType}
                          </Badge>
                        </TableCell>
                        <TableCell className="px-4 py-3">
                          <div className="flex items-center space-x-1">
                            <MapPin className="w-4 h-4 text-muted-foreground" />
                            <span>{property.city}, {property.state}</span>
                            {property.pincode && (
                              <span className="text-xs text-muted-foreground">({property.pincode})</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="px-4 py-3 font-medium">
                          <span className="line-clamp-1">{property.address}</span>
                        </TableCell>
                        <TableCell className="px-4 py-3">
                          <EntityCardMenu
                            entityType="property"
                            entityId={property.id}
                            entityLabel={property.name}
                            onOverview={() => setOverviewProperty(property)}
                            onEdit={() => handleEdit(property)}
                            onDelete={() => handleDelete(property)}
                            dataTestId={`property-kebab-${property.id}`}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {filteredAndSortedProperties.length === 0 && (
          <Card className="text-center py-12">
            <CardContent>
              <Building className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-lg font-medium mb-2">No properties found</h3>
              <p className="text-muted-foreground mb-4">
                {searchQuery || filterValue !== "all" 
                  ? "Try adjusting your search or filter criteria." 
                  : "Start by adding your first property."}
              </p>
              <Button onClick={() => setShowAddDialog(true)} data-testid="button-add-first-property">
                <Plus className="w-4 h-4 mr-2" />
                Add Property
              </Button>
            </CardContent>
          </Card>
        )}
        </div>

      {/* Add Property Modal */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" data-testid="modal-add-property">
          <DialogHeader>
            <DialogTitle>Add New Property</DialogTitle>
            <div className="text-sm text-muted-foreground">
              Maintain property details, key dates, compliance items, and supporting documents for each location.
            </div>
          </DialogHeader>
          <PropertyForm 
            mode="create"
            onSuccess={() => setShowAddDialog(false)} 
            onCancel={() => setShowAddDialog(false)} 
          />
        </DialogContent>
      </Dialog>

      {/* Edit Property Modal with Tabs */}
      <Dialog open={!!editingProperty} onOpenChange={(open) => !open && setEditingProperty(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" data-testid="modal-edit-property">
          <DialogHeader>
            <DialogTitle>{editingProperty?.name || 'Edit Property'}</DialogTitle>
            {editingProperty?.createdAt && (
              <div className="flex items-center text-sm text-muted-foreground mt-1">
                <Calendar className="w-4 h-4 mr-2" />
                <span>Created: {format(new Date(editingProperty.createdAt), "MMM d, yyyy")}</span>
              </div>
            )}
          </DialogHeader>
          
          <Tabs defaultValue="overview" className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-4">
              <TabsTrigger value="overview" className="gap-2">
                <Building className="w-4 h-4" />
                Overview
              </TabsTrigger>
              <TabsTrigger value="documents" className="gap-2">
                <FileText className="w-4 h-4" />
                Documents
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="overview">
              <PropertyForm 
                mode="edit"
                initialData={editingProperty}
                onSuccess={() => setEditingProperty(null)} 
                onCancel={() => setEditingProperty(null)} 
              />
            </TabsContent>
            
            <TabsContent value="documents">
              {editingProperty && (
                <PropertyDocumentsTab 
                  propertyId={editingProperty.id}
                  propertyName={editingProperty.name}
                />
              )}
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog - Type to Confirm */}
      <ConfirmDeleteByNameDialog
        open={!!deletingProperty}
        onClose={() => setDeletingProperty(null)}
        entityLabel="Property"
        entityName={deletingProperty?.name ?? ""}
        onConfirm={async () => {
          if (!deletingProperty) return;
          await deletePropertyMutation.mutateAsync(deletingProperty.id);
          setDeletingProperty(null);
        }}
      />

      {/* Overview Modal */}
      {overviewProperty && (
        <EntityOverviewModal
          open={!!overviewProperty}
          onOpenChange={(open) => !open && setOverviewProperty(null)}
          entityType="property"
          entityId={overviewProperty.id}
          entityLabel={overviewProperty.name}
          entitySummary={{
            name: overviewProperty.name,
            propertyType: overviewProperty.propertyType,
            address: overviewProperty.address || "N/A",
            city: overviewProperty.city || "N/A",
            state: overviewProperty.state || "N/A",
            zipCode: overviewProperty.zipCode || "N/A",
            notes: overviewProperty.notes || "No notes",
            createdAt: overviewProperty.createdAt ? format(new Date(overviewProperty.createdAt), "MMM d, yyyy") : "Unknown",
          }}
        />
      )}
    </div>
  );
}