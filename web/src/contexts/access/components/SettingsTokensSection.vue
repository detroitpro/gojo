<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";

import {
  changePassword,
  createApiToken,
  getMe,
  listApiTokens,
  revokeApiToken,
} from "@/contexts/access/contract";
import AppButton from "@/ui/AppButton.vue";
import SettingsPasswordForm from "@/contexts/access/components/SettingsPasswordForm.vue";
import SortableTh from "@/ui/SortableTh.vue";
import TablePager from "@/ui/TablePager.vue";
import { useServerTable } from "@/platform/useServerTable";
import { KeyRound, Trash2 } from "lucide-vue-next";
import type { User } from "@/contexts/access/types";

const emit = defineEmits<{
  error: [message: string];
  message: [message: string];
}>();

const router = useRouter();
const me = ref<User | null>(null);
const currentPassword = ref("");
const newPassword = ref("");
const confirmPassword = ref("");
const tokenName = ref("");
const createdToken = ref<string | null>(null);
const busy = ref(false);
const tokenQuery = ref("");

const {
  page: tokenPage,
  pages: tokenPages,
  items: tokenItems,
  total: tokenTotal,
  sort: tokenSort,
  order: tokenOrder,
  setSort: setTokenSort,
  rangeLabel: tokenRange,
  load: loadTokens,
} = useServerTable({
  defaultSort: "createdAt",
  defaultOrder: "desc",
  watchSources: [tokenQuery],
  fetchPage: ({ limit, offset, sort, order }) =>
    listApiTokens({
      limit,
      offset,
      sort,
      order,
      q: tokenQuery.value || undefined,
    }),
});

async function load() {
  me.value = await getMe();
  await loadTokens();
}

async function submitPasswordChange() {
  if (newPassword.value !== confirmPassword.value) {
    emit("error", "New password and confirmation do not match");
    return;
  }
  if (newPassword.value.length < 8) {
    emit("error", "New password must be at least 8 characters");
    return;
  }
  busy.value = true;
  try {
    await changePassword(currentPassword.value, newPassword.value);
    currentPassword.value = "";
    newPassword.value = "";
    confirmPassword.value = "";
    emit("message", "Password changed — sign in again");
    await router.push({ name: "login" });
  } catch (err) {
    emit("error", err instanceof Error ? err.message : "Failed to change password");
  } finally {
    busy.value = false;
  }
}

async function createToken() {
  if (!tokenName.value.trim()) return;
  busy.value = true;
  createdToken.value = null;
  try {
    const created = await createApiToken(tokenName.value.trim());
    createdToken.value = created.token;
    tokenName.value = "";
    await loadTokens();
  } catch (err) {
    emit("error", err instanceof Error ? err.message : "Failed to create token");
  } finally {
    busy.value = false;
  }
}

async function revokeToken(id: string) {
  if (!confirm("Revoke this API token?")) return;
  busy.value = true;
  try {
    await revokeApiToken(id);
    await loadTokens();
  } catch (err) {
    emit("error", err instanceof Error ? err.message : "Failed to revoke token");
  } finally {
    busy.value = false;
  }
}

defineExpose({ load });
void load();
</script>

<template>
  <section class="panel">
    <div class="panel-header">Account</div>
    <div class="panel-body">
      <p class="muted mb-5">
        Signed in as
        <span class="mono">{{ me?.username ?? "—" }}</span>
        <span v-if="me?.role" class="muted"> ({{ me.role }})</span>.
        Changing your password signs you out; API tokens keep working.
      </p>
      <SettingsPasswordForm
        v-model:current-password="currentPassword"
        v-model:new-password="newPassword"
        v-model:confirm-password="confirmPassword"
        :busy="busy"
        @submit="submitPasswordChange"
      />
    </div>
  </section>

  <section class="panel">
    <div class="panel-header">Authentication — API tokens</div>
    <div class="panel-body">
      <form class="inline-form" @submit.prevent="createToken">
        <div class="field">
          <label for="token-name">Token name</label>
          <input id="token-name" v-model="tokenName" placeholder="ci-bot" required />
        </div>
        <AppButton
          variant="primary"
          :icon="KeyRound"
          type="submit"
          :loading="busy"
          loading-label="Creating…"
          :disabled="!tokenName.trim()"
        >
          Create token
        </AppButton>
      </form>
      <div v-if="createdToken" class="alert alert-info mt-5">
        Copy this token now; it will not be shown again.
        <pre class="pre-block mt-3">{{ createdToken }}</pre>
      </div>
      <div class="inline-form mt-5 task-filters">
        <div class="field flex-2">
          <label for="token-search">Search</label>
          <input
            id="token-search"
            v-model="tokenQuery"
            class="input"
            type="search"
            placeholder="Token name…"
          />
        </div>
      </div>
      <div v-if="tokenTotal === 0" class="muted mt-5">
        {{ tokenQuery.trim() ? "No tokens match these filters" : "No tokens" }}
      </div>
      <template v-else>
        <div class="table-wrap mt-5">
          <table class="data">
            <thead>
              <tr>
                <SortableTh
                  column="name"
                  label="Name"
                  :sort="tokenSort"
                  :order="tokenOrder"
                  @sort="setTokenSort"
                />
                <SortableTh
                  column="createdAt"
                  label="Created"
                  :sort="tokenSort"
                  :order="tokenOrder"
                  default-order="desc"
                  @sort="setTokenSort"
                />
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="token in tokenItems" :key="token.id">
                <td>{{ token.name }}</td>
                <td class="mono muted">{{ new Date(token.createdAt).toLocaleString() }}</td>
                <td>
                  <AppButton
                    variant="danger"
                    size="sm"
                    :icon="Trash2"
                    :loading="busy"
                    loading-label="Working…"
                    @click="revokeToken(token.id)"
                  >
                    Revoke
                  </AppButton>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <TablePager
          v-model:page="tokenPage"
          :page-count="tokenPages"
          :range-label="tokenRange"
          :total="tokenTotal"
        />
      </template>
    </div>
  </section>
</template>
