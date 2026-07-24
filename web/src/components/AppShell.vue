<script setup lang="ts">
import { computed } from "vue";
import { RouterLink, RouterView, useRoute, useRouter } from "vue-router";

import { logout } from "@/api";

const route = useRoute();
const router = useRouter();

const nav = [
  { to: "/", label: "Dashboard", name: "dashboard" },
  { to: "/projects", label: "Projects", name: "projects" },
  { to: "/tasks", label: "Tasks", name: "tasks" },
  { to: "/runs", label: "Runs", name: "runs" },
  { to: "/schedules", label: "Schedules", name: "schedules" },
  { to: "/agents", label: "Agents", name: "agents" },
  { to: "/settings", label: "Settings", name: "settings" },
];

const activeName = computed(() => {
  if (route.name === "run-detail") {
    return "runs";
  }
  return route.name as string;
});

async function signOut() {
  await logout();
  await router.push({ name: "login" });
}
</script>

<template>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand">gojo</div>
      <RouterLink
        v-for="item in nav"
        :key="item.name"
        :to="item.to"
        class="nav-link"
        :class="{ active: activeName === item.name }"
      >
        {{ item.label }}
      </RouterLink>
      <div class="sidebar-footer">
        <button class="btn btn-sm" type="button" @click="signOut">Sign out</button>
      </div>
    </aside>
    <main class="main">
      <RouterView />
    </main>
  </div>
</template>
