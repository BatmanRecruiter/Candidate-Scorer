import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import NewJob from "@/pages/new-job";
import JobView from "@/pages/job-view";
import JobsList from "@/pages/jobs-list";
import ManageRoles from "@/pages/manage-roles";

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/new" component={NewJob} />
      <Route path="/jobs" component={JobsList} />
      <Route path="/jobs/:id" component={JobView} />
      <Route path="/manage" component={ManageRoles} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router hook={useHashLocation}>
          <AppRouter />
        </Router>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
