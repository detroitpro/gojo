<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { RouterLink, RouterView, useRoute, useRouter } from "vue-router";

import { logout } from "@/api";
import { usePlatformEvents } from "@/composables/usePlatformEvents";

const route = useRoute();
const router = useRouter();

const STORAGE_KEY = "gojo.sidebar.collapsed";

const nav = [
  {
    to: "/projects",
    label: "Projects",
    name: "projects",
    icon: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z",
  },
  {
    to: "/tasks",
    label: "Tasks",
    name: "tasks",
    icon: "M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2m-6 9l2 2 4-4",
  },
  {
    to: "/runs",
    label: "Runs",
    name: "runs",
    icon: "M13 10V3L4 14h7v7l9-11h-7z",
  },
  {
    to: "/queue",
    label: "Queue",
    name: "queue",
    icon: "M4 6h16M4 12h10M4 18h14",
  },
  {
    to: "/schedules",
    label: "Schedules",
    name: "schedules",
    icon: "M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0z",
  },
  {
    to: "/agents",
    label: "Agents",
    name: "agents",
    icon: "M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2z",
  },
  {
    to: "/settings",
    label: "Settings",
    name: "settings",
    icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
  },
] as const;

const collapsed = ref(false);
const mobileOpen = ref(false);
const { status: eventStatus, reconnect: reconnectEvents } = usePlatformEvents({
  topics: [],
  onEvent: () => {},
});
const eventStatusLabel = computed(() => {
  if (eventStatus.value === "connected") return "Live";
  if (eventStatus.value === "degraded") return "Reconnecting";
  if (eventStatus.value === "connecting") return "Connecting";
  return "Offline";
});

const activeName = computed(() => {
  if (route.name === "run-detail") {
    return "runs";
  }
  if (route.name === "dashboard") {
    return "dashboard";
  }
  return route.name as string;
});

watch(collapsed, (value) => {
  localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
});

watch(
  () => route.fullPath,
  () => {
    mobileOpen.value = false;
  },
);

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    mobileOpen.value = false;
  }
}

onMounted(() => {
  collapsed.value = localStorage.getItem(STORAGE_KEY) === "1";
  window.addEventListener("keydown", onKeydown);
});

onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown);
});

function toggleCollapsed() {
  collapsed.value = !collapsed.value;
}

function toggleMobile() {
  mobileOpen.value = !mobileOpen.value;
}

async function signOut() {
  await logout();
  await router.push({ name: "login" });
}
</script>

<template>
  <div class="shell" :class="{ 'sidebar-collapsed': collapsed, 'mobile-nav-open': mobileOpen }">
    <header class="topbar">
      <button
        class="icon-btn hamburger"
        type="button"
        aria-label="Open navigation"
        @click="toggleMobile"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            d="M4 7h16M4 12h16M4 17h16"
          />
        </svg>
      </button>
      <RouterLink to="/" class="brand brand-mobile" title="Dashboard">gojo</RouterLink>
      <button
        class="live-status live-status-mobile"
        type="button"
        :title="`Updates: ${eventStatusLabel}`"
        @click="reconnectEvents"
      >
        <span class="live-dot" :class="`live-dot-${eventStatus}`" />
        <span>{{ eventStatusLabel }}</span>
      </button>
    </header>

    <div
      v-if="mobileOpen"
      class="sidebar-backdrop"
      aria-hidden="true"
      @click="mobileOpen = false"
    />

    <aside class="sidebar" :aria-label="collapsed ? 'Collapsed navigation' : 'Navigation'">
      <div class="sidebar-top">
        <RouterLink to="/" class="brand-mark" title="Dashboard">
          <span class="brand-word">gojo</span>
          <span class="brand-tag">ops console</span>
        </RouterLink>
        <button
          class="icon-btn collapse-btn"
          type="button"
          :aria-label="collapsed ? 'Expand sidebar' : 'Collapse sidebar'"
          :title="collapsed ? 'Expand' : 'Collapse'"
          @click="toggleCollapsed"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              :d="collapsed ? 'M9 6l6 6-6 6' : 'M15 6l-6 6 6 6'"
            />
          </svg>
        </button>
        <button
          class="icon-btn close-mobile"
          type="button"
          aria-label="Close navigation"
          @click="mobileOpen = false"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              d="M6 6l12 12M18 6L6 18"
            />
          </svg>
        </button>
      </div>

      <nav class="sidebar-nav">
        <RouterLink
          v-for="item in nav"
          :key="item.name"
          :to="item.to"
          class="nav-link"
          :class="{ active: activeName === item.name }"
          :title="item.label"
        >
          <svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              stroke-width="1.75"
              stroke-linecap="round"
              stroke-linejoin="round"
              :d="item.icon"
            />
          </svg>
          <span class="nav-label">{{ item.label }}</span>
        </RouterLink>
      </nav>

      <div class="sidebar-footer">
        <button
          class="live-status"
          type="button"
          :title="`Updates: ${eventStatusLabel}`"
          @click="reconnectEvents"
        >
          <span class="live-dot" :class="`live-dot-${eventStatus}`" />
          <span class="live-label">{{ eventStatusLabel }}</span>
        </button>
        <button class="btn btn-sm" type="button" @click="signOut">Sign out</button>
      </div>
    </aside>

    <main class="main">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.live-status {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0;
  border: 0;
  color: var(--text-muted);
  background: transparent;
  font: inherit;
  font-size: 0.75rem;
  cursor: pointer;
}

.live-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 999px;
  background: var(--text-muted);
}

.live-dot-connected {
  background: var(--green);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--green) 18%, transparent);
}

.live-dot-connecting {
  background: var(--amber);
}

.live-dot-degraded {
  background: var(--red);
}

.live-status-mobile {
  margin-left: auto;
}

.sidebar-collapsed .live-label {
  display: none;
}

@media (min-width: 769px) {
  .live-status-mobile {
    display: none;
  }
}
</style>
