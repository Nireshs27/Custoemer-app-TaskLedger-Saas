import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle, Clock, Building, List } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface DashboardStats {
  overdue: number;
  thisWeek: number;
  properties: number;
  assets: number;
  vehicles: number;
}

export default function StatsCards() {
  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard/stats"],
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {[...Array(4)].map((_, i) => (
          <Card key={i} className="p-6 shadow-md hover:-translate-y-1 transition-all duration-300">
            <div className="flex items-center justify-between">
              <div className="space-y-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-8 w-12" />
              </div>
              <Skeleton className="w-12 h-12 rounded-lg" />
            </div>
          </Card>
        ))}
      </div>
    );
  }

  const statCards = [
    {
      label: "Overdue Items",
      value: stats?.overdue || 0,
      icon: AlertCircle,
      color: "text-destructive",
      bgColor: "bg-destructive/10",
      testId: "stat-overdue"
    },
    {
      label: "Due This Week",
      value: stats?.thisWeek || 0,
      icon: Clock,
      color: "text-chart-2",
      bgColor: "bg-chart-2/10",
      testId: "stat-thisweek"
    },
    {
      label: "Active Properties",
      value: stats?.properties || 0,
      icon: Building,
      color: "text-primary",
      bgColor: "bg-primary/10",
      testId: "stat-properties"
    },
    {
      label: "Total Assets",
      value: (stats?.assets || 0) + (stats?.vehicles || 0),
      icon: List,
      color: "text-foreground",
      bgColor: "bg-muted",
      testId: "stat-assets"
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      {statCards.map((stat) => {
        const Icon = stat.icon;
        return (
          <Card key={stat.label} className="shadow-md hover:-translate-y-1 transition-all duration-300">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    {stat.label}
                  </p>
                  <p 
                    className={`text-2xl font-bold ${stat.color}`}
                    data-testid={stat.testId}
                  >
                    {stat.value}
                  </p>
                </div>
                <div className={`w-12 h-12 ${stat.bgColor} rounded-lg flex items-center justify-center`}>
                  <Icon className={`${stat.color}`} />
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
