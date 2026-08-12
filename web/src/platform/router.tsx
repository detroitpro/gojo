import { useEffect, useState, type ReactElement } from "react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";

import { checkSession } from "@/contexts/access/contract";
import { AppShell } from "@/ui/AppShell";
import { gojoSocket } from "@/infrastructure/ws-client";
import { LoginView } from "@/contexts/access/views/LoginView";
import { DashboardView } from "@/contexts/operations/views/DashboardView";
import { SettingsView } from "@/contexts/operations/views/SettingsView";
import { ProjectsView } from "@/contexts/catalog/views/ProjectsView";
import { ProjectShellView } from "@/contexts/catalog/views/ProjectShellView";
import { ProjectOverviewView } from "@/contexts/catalog/views/ProjectOverviewView";
import { ProjectHistoryView } from "@/contexts/catalog/views/ProjectHistoryView";
import { ProjectImpactPageView } from "@/contexts/catalog/views/ProjectImpactPageView";
import { ProjectHealthView } from "@/contexts/catalog/views/ProjectHealthView";
import { ProjectConfigurationView } from "@/contexts/catalog/views/ProjectConfigurationView";
import { AgentsView } from "@/contexts/catalog/views/AgentsView";
import { AgentDetailView } from "@/contexts/catalog/views/AgentDetailView";
import { RunsView } from "@/contexts/execution/views/RunsView";
import { RunDetailView } from "@/contexts/execution/views/RunDetailView";
import { IntegrationsView } from "@/contexts/delivery/views/IntegrationsView";
import { ApprovalsView } from "@/contexts/delivery/views/ApprovalsView";
import { ImpactView } from "@/contexts/catalog/views/ImpactView";
import { QueueView } from "@/contexts/scheduling/views/QueueView";
import { SchedulesView } from "@/contexts/catalog/views/SchedulesView";
import { AdaptersView } from "@/contexts/catalog/views/AdaptersView";

type GateStatus = "loading" | "authed" | "anon";

function useAuthGate(): GateStatus {
  const [status, setStatus] = useState<GateStatus>("loading");
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await checkSession();
        if (cancelled) return;
        setStatus(session ? "authed" : "anon");
      } catch {
        if (!cancelled) setStatus("anon");
      }
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
    // Re-check on route change so login → dashboard flips this gate.
  }, [location.pathname]);

  useEffect(() => {
    const off = gojoSocket.onReauth(() => {
      setStatus("anon");
      navigate("/login", { replace: true });
    });
    return () => off();
  }, [navigate]);

  return status;
}

function RequireAuth({ children }: { children: ReactElement }) {
  const status = useAuthGate();
  const location = useLocation();
  if (status === "loading") return null;
  if (status === "anon") {
    const redirect = `${location.pathname}${location.search}${location.hash}`;
    const q = redirect && redirect !== "/" ? `?redirect=${encodeURIComponent(redirect)}` : "";
    return <Navigate to={`/login${q}`} replace />;
  }
  return children;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginView />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardView />} />
        <Route path="projects" element={<ProjectsView />} />
        <Route path="projects/:id" element={<ProjectShellView />}>
          <Route index element={<Navigate to="overview" replace />} />
          <Route path="overview" element={<ProjectOverviewView />} />
          <Route path="history" element={<ProjectHistoryView />} />
          <Route path="impact" element={<ProjectImpactPageView />} />
          <Route path="health" element={<ProjectHealthView />} />
          <Route path="configuration" element={<ProjectConfigurationView />} />
        </Route>
        <Route path="agents" element={<AgentsView />} />
        <Route path="agents/:id" element={<AgentDetailView />} />
        <Route path="runs" element={<RunsView />} />
        <Route path="runs/:id" element={<RunDetailView />} />
        <Route path="integrations" element={<IntegrationsView />} />
        <Route path="approvals" element={<ApprovalsView />} />
        <Route path="impact" element={<ImpactView />} />
        <Route path="queue" element={<QueueView />} />
        <Route path="schedules" element={<SchedulesView />} />
        <Route path="adapters" element={<AdaptersView />} />
        <Route path="settings" element={<SettingsView />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
