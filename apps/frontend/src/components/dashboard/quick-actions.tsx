import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Receipt, Building, Car, ServerCog, Upload, ListTodo } from "lucide-react";
import { useLocation } from "wouter";

interface QuickActionsProps {
  onAddNew?: () => void;
}

export default function QuickActions({ onAddNew }: QuickActionsProps) {
  const [, setLocation] = useLocation();

  const actions = [
    {
      id: 'property',
      label: 'Add Property',
      icon: Building,
      color: 'chart-2',
      description: 'Properties and real estate',
      path: '/properties'
    },
    {
      id: 'vehicle',
      label: 'Add Vehicle',
      icon: Car,
      color: 'chart-3',
      description: 'Vehicle insurance, registration',
      path: '/vehicles'
    },
    {
      id: 'asset',
      label: 'Add Asset',
      icon: ServerCog,
      color: 'chart-4',
      description: 'Machinery, equipment, warranties',
      path: '/assets'
    },
    {
      id: 'taskAction',
      label: 'Add Task Action',
      icon: ListTodo,
      color: 'chart-1',
      description: 'Create custom task with reminders',
      path: '/task-actions'
    },
  ];

  return (
    <Card className="shadow-md hover:-translate-y-1 transition-all duration-300">
      <CardHeader className="pb-4">
        <h2 className="text-lg font-semibold text-foreground">Quick Actions</h2>
      </CardHeader>
      <CardContent className="space-y-3">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <Button
              key={action.id}
              variant="ghost"
              onClick={() => setLocation(action.path)}
              className={`w-full flex items-center space-x-3 p-4 border rounded-full bg-${action.color}/5 hover:bg-${action.color}/10 shadow-md transition-all duration-200 group justify-start h-auto`}
              data-testid={`quick-action-${action.id}`}
            >
              <div className={`w-10 h-10 bg-${action.color}/10 rounded-lg flex items-center justify-center group-hover:bg-${action.color}/20`}>
                <Icon className={`w-5 h-5 text-${action.color}`} />
              </div>
              <div className="text-left">
                <span className="font-medium text-foreground block">{action.label}</span>
                <span className="text-xs text-muted-foreground">{action.description}</span>
              </div>
            </Button>
          );
        })}

        <div className="w-full p-4 relative border rounded-full before:absolute before:top-0 before:left-0 before:right-0 before:h-[1px] before:bg-gradient-to-r before:from-transparent before:via-border/50 before:to-transparent">
          <Button
            variant="ghost"
            onClick={onAddNew}
            className="w-full flex items-center space-x-3 p-4 rounded-lg bg-muted/30 hover:bg-muted/50 transition-all duration-200 group justify-start"
            data-testid="quick-action-upload"
          >
            <div className="w-10 h-10 bg-muted rounded-lg flex items-center justify-center">
              <Upload className="w-5 h-5 text-muted-foreground" />
            </div>
            <div className="text-left">
              <span className="font-medium text-foreground block">Upload Document</span>
              <span className="text-xs text-muted-foreground">Receipts, certificates, bills</span>
            </div>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
