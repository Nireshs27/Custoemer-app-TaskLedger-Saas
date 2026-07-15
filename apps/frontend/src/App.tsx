import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "./hooks/use-auth";
import { ProtectedRoute } from "./lib/protected-route";
import Dashboard from "@/pages/dashboard";
import AuthPage from "@/pages/auth-page";
import RegisterPage from "@/pages/register-page";
import NotFound from "@/pages/not-found";
import Vehicles from "@/pages/vehicles";
import Assets from "@/pages/assets";
import Properties from "@/pages/properties";
import TaxTracker from "@/pages/tax-tracker";
import { SettingsPage } from "@/pages/settings";
import TaskActions from "@/pages/task-actions";
import OccurrenceTimelinePage from "@/pages/occurrence-timeline";
import MissedReminderInboxPage from "@/pages/missed-reminders-inbox";

function Router() {
  return (
    <Switch>
      <ProtectedRoute path="/" component={Dashboard} />
      <ProtectedRoute path="/vehicles" component={Vehicles} />
      <ProtectedRoute path="/assets" component={Assets} />
      <ProtectedRoute path="/tax-tracker" component={TaxTracker} />
      <ProtectedRoute path="/task-actions" component={TaskActions} />
      <ProtectedRoute path="/properties" component={Properties} />
      <ProtectedRoute path="/settings" component={SettingsPage} />
      <ProtectedRoute path="/missed-reminders" component={MissedReminderInboxPage} />
      <ProtectedRoute
        path="/occurrences/:entityType/:entityId/timeline"
        component={OccurrenceTimelinePage}
      />
      <Route path="/auth" component={AuthPage} />
      <Route path="/register" component={RegisterPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <Toaster />
          <Router />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
