import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Building, Home, Warehouse } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { Property } from "@shared/schema";

export default function PropertiesOverview() {
  const { data: properties, isLoading } = useQuery<Property[]>({
    queryKey: ["/api/properties"],
  });

  if (isLoading) {
    return (
      <Card className="shadow-md hover:-translate-y-1 transition-all duration-300">
        <CardHeader className="pb-4">
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <Skeleton className="w-8 h-8 rounded-lg" />
                  <div className="space-y-1">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                </div>
                <div className="text-right">
                  <Skeleton className="h-4 w-16" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const getPropertyIcon = (propertyType: string) => {
    switch (propertyType.toLowerCase()) {
      case 'office':
        return Building;
      case 'residential':
        return Home;
      case 'warehouse':
        return Warehouse;
      default:
        return Building;
    }
  };

  const getIconColor = (index: number) => {
    const colors = ['text-primary', 'text-chart-2', 'text-chart-3', 'text-chart-4'];
    return colors[index % colors.length];
  };

  const getBgColor = (index: number) => {
    const colors = ['bg-primary/10', 'bg-chart-2/10', 'bg-chart-3/10', 'bg-chart-4/10'];
    return colors[index % colors.length];
  };

  return (
    <Card className="shadow-md hover:-translate-y-1 transition-all duration-300">
      <CardHeader className="pb-4">
        <h2 className="text-lg font-semibold text-foreground">Properties Overview</h2>
      </CardHeader>
      <CardContent>
        {!properties || properties.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-muted-foreground">No properties added yet</p>
          </div>
        ) : (
          <div className="space-y-4">
            {properties.slice(0, 5).map((property, index) => {
              const Icon = getPropertyIcon(property.propertyType);
              const iconColor = getIconColor(index);
              const bgColor = getBgColor(index);

              return (
                <div 
                  key={property.id} 
                  className="flex items-center justify-between"
                  data-testid={`property-${property.id}`}
                >
                  <div className="flex items-center space-x-3 min-w-0 flex-1">
                    <div className={`w-8 h-8 ${bgColor} rounded-lg flex items-center justify-center shrink-0`}>
                      <Icon className={`w-4 h-4 ${iconColor}`} />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-foreground truncate" data-testid={`property-name-${property.id}`}>
                        {property.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {property.city}, {property.state}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-muted-foreground">
                      {/* This would need to be calculated from related tax items */}
                      Active
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
