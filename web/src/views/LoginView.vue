<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";

import { checkSession, getHealth, login, probeSetupNeeded, setup } from "@/api";
import { ApiError } from "@/types";

const router = useRouter();
const route = useRoute();

const mode = ref<"loading" | "setup" | "login">("loading");
const username = ref("");
const password = ref("");
const error = ref("");
const busy = ref(false);
const version = ref("");

onMounted(async () => {
  try {
    const health = await getHealth();
    version.value = health.version;

    // Force a probe on the login page so a stale "logged out" cache cannot
    // strand an already-authenticated browser after a soft reload.
    const session = await checkSession({ force: true });
    if (session) {
      const redirect = typeof route.query.redirect === "string" ? route.query.redirect : "/";
      await router.replace(redirect);
      return;
    }

    const needsSetup = await probeSetupNeeded();
    mode.value = needsSetup ? "setup" : "login";
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to reach API";
    mode.value = "login";
  }
});

async function submit() {
  error.value = "";
  busy.value = true;
  try {
    if (mode.value === "setup") {
      await setup(username.value.trim(), password.value);
    } else {
      await login(username.value.trim(), password.value);
    }
    const redirect = typeof route.query.redirect === "string" ? route.query.redirect : "/";
    await router.replace(redirect);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Request failed";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="auth-page">
    <div class="auth-box">
      <h1>gojo</h1>
      <p v-if="mode === 'setup'" class="auth-purpose">
        Create the admin account to finish setting up this instance.
      </p>
      <p v-else-if="mode === 'login'" class="auth-purpose">
        Scheduled agent orchestration — sign in to the ops console.
      </p>
      <p v-else class="auth-purpose">Connecting…</p>

      <div v-if="version" class="mono muted text-sm mb-6">v{{ version }}</div>

      <div v-if="error" class="alert alert-error">{{ error }}</div>

      <form v-if="mode !== 'loading'" @submit.prevent="submit">
        <div class="field">
          <label for="username">Username</label>
          <input id="username" v-model="username" autocomplete="username" required />
        </div>
        <div class="field">
          <label for="password">Password</label>
          <input
            id="password"
            v-model="password"
            type="password"
            autocomplete="new-password"
            required
          />
        </div>
        <button class="btn btn-primary w-full" type="submit" :disabled="busy">
          {{ mode === "setup" ? "Complete setup" : "Sign in" }}
        </button>
      </form>
    </div>
  </div>
</template>
