<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";

import { checkSession, getHealth, getInstance, login, probeSetupNeeded, setup } from "@/api";
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

    try {
      await getInstance();
      const redirect = typeof route.query.redirect === "string" ? route.query.redirect : "/";
      await router.replace(redirect);
      return;
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 401) {
        throw err;
      }
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
    await checkSession();
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
      <p v-if="mode === 'setup'">Initial setup — create the admin account.</p>
      <p v-else-if="mode === 'login'">Sign in to the ops console.</p>
      <p v-else>Connecting…</p>

      <div v-if="version" class="muted" style="margin-bottom: 14px">v{{ version }}</div>

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
        <button class="btn btn-primary" type="submit" :disabled="busy" style="width: 100%">
          {{ mode === "setup" ? "Complete setup" : "Sign in" }}
        </button>
      </form>
    </div>
  </div>
</template>
