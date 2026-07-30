import { createRouter, createWebHistory } from "vue-router";

import { checkSession } from "./api";
import AdaptersView from "./views/AdaptersView.vue";
import AgentDetailView from "./views/AgentDetailView.vue";
import AgentsView from "./views/AgentsView.vue";
import AppShell from "./components/AppShell.vue";
import DashboardView from "./views/DashboardView.vue";
import ImpactView from "./views/ImpactView.vue";
import IntegrationsView from "./views/IntegrationsView.vue";
import LoginView from "./views/LoginView.vue";
import ProjectDetailView from "./views/ProjectDetailView.vue";
import ProjectsView from "./views/ProjectsView.vue";
import QueueView from "./views/QueueView.vue";
import RunDetailView from "./views/RunDetailView.vue";
import RunsView from "./views/RunsView.vue";
import SchedulesView from "./views/SchedulesView.vue";
import SettingsView from "./views/SettingsView.vue";
import { gojoSocket } from "./lib/ws-client";

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
