import { createRouter, createWebHistory } from "vue-router";

import { checkSession } from "./api";
import AppShell from "./components/AppShell.vue";
import AgentsView from "./views/AgentsView.vue";
import DashboardView from "./views/DashboardView.vue";
import LoginView from "./views/LoginView.vue";
import ProjectDetailView from "./views/ProjectDetailView.vue";
import ProjectsView from "./views/ProjectsView.vue";
import RunDetailView from "./views/RunDetailView.vue";
import RunsView from "./views/RunsView.vue";
import SchedulesView from "./views/SchedulesView.vue";
import SettingsView from "./views/SettingsView.vue";
import TasksView from "./views/TasksView.vue";

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
        { path: "tasks", name: "tasks", component: TasksView },
        { path: "runs", name: "runs", component: RunsView },
        { path: "runs/:id", name: "run-detail", component: RunDetailView },
        { path: "schedules", name: "schedules", component: SchedulesView },
        { path: "agents", name: "agents", component: AgentsView },
        { path: "settings", name: "settings", component: SettingsView },
      ],
    },
  ],
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
