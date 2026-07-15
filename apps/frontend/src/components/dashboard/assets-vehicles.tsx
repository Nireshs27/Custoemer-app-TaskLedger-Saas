import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { Vehicle, Asset, VehicleItem, AssetItem } from "@shared/schema";
import { getEffectiveDueDate } from "@/lib/effective-due-date";

export default function AssetsVehicles() {
  const { data: vehicles, isLoading: vehiclesLoading } = useQuery<Vehicle[]>({
    queryKey: ["/api/vehicles"],
  });

  const { data: assets = [], isLoading: assetsLoading } = useQuery<Asset[]>({
    queryKey: ["/api/assets"],
  });

  const { data: vehicleItems = [], isLoading: vehicleItemsLoading } = useQuery<VehicleItem[]>({
    queryKey: ["/api/vehicle-items"],
  });

  const { data: assetItems = [], isLoading: assetItemsLoading } = useQuery<AssetItem[]>({
    queryKey: ["/api/asset-items"],
  });

  const isLoading = vehiclesLoading || assetsLoading || vehicleItemsLoading || assetItemsLoading;

  if (isLoading) {
    return (
      <Card className="shadow-md hover:-translate-y-1 transition-all duration-300">
        <CardHeader className="pb-4">
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="p-3 rounded-lg bg-muted/30">
                <div className="flex items-center justify-between mb-2">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-3 w-16" />
                </div>
                <div className="flex justify-between">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const getItemStats = (items: (VehicleItem | AssetItem)[]) => {
    const today = new Date();
    const overdue = items.filter(item => {
      const eff = getEffectiveDueDate(item as any);
      const dueDate = eff ?? new Date(item.dueDate);
      return dueDate < today && item.status === 'pending';
    }).length;

    const upcoming = items.filter(item => {
      const eff = getEffectiveDueDate(item as any);
      const dueDate = eff ?? new Date(item.dueDate);
      const diffTime = dueDate.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      return diffDays >= 0 && diffDays <= 30 && item.status === 'pending';
    }).length;

    return { overdue, upcoming };
  };

  const vehicleStats = getItemStats(vehicleItems || []);
  const assetStats = getItemStats(assetItems || []);

  const sections = [
    {
      label: 'Vehicles',
      total: vehicles?.length || 0,
      overdue: vehicleStats.overdue,
      upcoming: vehicleStats.upcoming,
      testId: 'vehicles'
    },
    {
      label: 'Machinery',
      total: assets?.filter(asset => asset.assetType === 'machinery').length || 0,
      overdue: 0, // Would need to filter asset items by machinery assets
      upcoming: 0,
      testId: 'machinery'
    },
    {
      label: 'Other Assets',
      total: assets?.filter(asset => asset.assetType !== 'machinery').length || 0,
      overdue: assetStats.overdue,
      upcoming: assetStats.upcoming,
      testId: 'assets'
    },
  ];

  return (
    <Card className="shadow-md hover:-translate-y-1 transition-all duration-300">
      <CardHeader className="pb-4">
        <h2 className="text-lg font-semibold text-foreground">Assets & Vehicles</h2>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {sections.map((section) => (
            <div 
              key={section.label} 
              className="p-3 rounded-lg bg-muted/30"
              data-testid={`section-${section.testId}`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-foreground">
                  {section.label}
                </span>
                <span 
                  className="text-xs text-muted-foreground"
                  data-testid={`total-${section.testId}`}
                >
                  {section.total} total
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span 
                  className={section.overdue > 0 ? "text-destructive" : "text-muted-foreground"}
                  data-testid={`overdue-${section.testId}`}
                >
                  {section.overdue > 0 ? `${section.overdue} overdue` : 'All current'}
                </span>
                <span 
                  className={section.upcoming > 0 ? "text-chart-2" : "text-muted-foreground"}
                  data-testid={`upcoming-${section.testId}`}
                >
                  {section.upcoming > 0 ? `${section.upcoming} upcoming` : 'None upcoming'}
                </span>
              </div>
            </div>
          ))}

          {sections.every(section => section.total === 0) && (
            <div className="text-center py-4">
              <p className="text-sm text-muted-foreground">No assets or vehicles added yet</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
