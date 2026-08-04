import { createRouter, createWebHistory } from "vue-router";

import { checkSession } from "@/contexts/access/contract";
import AdaptersView from "@/contexts/catalog/views/AdaptersView.vue";
import AgentDetailView from "@/contexts/catalog/views/AgentDetailView.vue";
import AgentsView from "@/contexts/catalog/views/AgentsView.vue";
import ApprovalsView from "@/contexts/delivery/views/ApprovalsView.vue";
import DashboardView from "@/contexts/operations/views/DashboardView.vue";
import ImpactView from "@/contexts/catalog/views/ImpactView.vue";
import IntegrationsView from "@/contexts/delivery/views/IntegrationsView.vue";
import LoginView from "@/contexts/access/views/LoginView.vue";
import ProjectDetailView from "@/contexts/catalog/views/ProjectDetailView.vue";
import ProjectsView from "@/contexts/catalog/views/ProjectsView.vue";
import QueueView from "@/contexts/scheduling/views/QueueView.vue";
import RunDetailView from "@/contexts/execution/views/RunDetailView.vue";
import RunsView from "@/contexts/execution/views/RunsView.vue";
import SchedulesView from "@/contexts/catalog/views/SchedulesView.vue";
import SettingsView from "@/contexts/operations/views/SettingsView.vue";
import AppShell from "@/ui/AppShell.vue";
import { gojoSocket } from "@/infrastructure/ws-client";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/login",
      name: "login",
      component: LoginView,
      meta: { public: true },
    },
    {
      path: "/",
      component: AppShell,
      children: [
        { path: "", name: "dashboard", component: DashboardView },
        { path: "projects", name: "projects", component: ProjectsView },
        { path: "projects/:id", name: "project-detail", component: ProjectDetailView },
        { path: "agents", name: "agents", component: AgentsView },
        { path: "agents/:id", name: "agent-detail", component: AgentDetailView },
        { path: "runs", name: "runs", component: RunsView },
        { path: "runs/:id", name: "run-detail", component: RunDetailView },
        { path: "integrations", name: "integrations", component: IntegrationsView },
        { path: "approvals", name: "approvals", component: ApprovalsView },
        { path: "impact", name: "impact", component: ImpactView },
        { path: "queue", name: "queue", component: QueueView },
        { path: "schedules", name: "schedules", component: SchedulesView },
        { path: "adapters", name: "adapters", component: AdaptersView },
        { path: "settings", name: "settings", component: SettingsView },
      ],
    },
  ],
});

gojoSocket.onReauth(() => {
  void router.push({ name: "login" });
});

router.beforeEach(async (to) => {
  const session = await checkSession();

  if (to.meta.public) {
    if (session && to.name === "login") {
      return { name: "dashboard" };
    }
    return true;
  }

  if (!session) {
    return { name: "login", query: { redirect: to.fullPath } };
  }

  return true;
});

export default router;
