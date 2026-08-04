<script setup lang="ts">
import AppButton from "@/ui/AppButton.vue";
import { ShieldCheck } from "lucide-vue-next";

defineProps<{
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
  busy: boolean;
}>();

const emit = defineEmits<{
  "update:currentPassword": [value: string];
  "update:newPassword": [value: string];
  "update:confirmPassword": [value: string];
  submit: [];
}>();
</script>

<template>
  <form class="stack-form" @submit.prevent="emit('submit')">
    <div class="field">
      <label for="current-password">Current password</label>
      <input
        id="current-password"
        type="password"
        autocomplete="current-password"
        required
        :value="currentPassword"
        @input="emit('update:currentPassword', ($event.target as HTMLInputElement).value)"
      />
    </div>
    <div class="field">
      <label for="new-password">New password</label>
      <input
        id="new-password"
        type="password"
        autocomplete="new-password"
        minlength="8"
        required
        :value="newPassword"
        @input="emit('update:newPassword', ($event.target as HTMLInputElement).value)"
      />
    </div>
    <div class="field">
      <label for="confirm-password">Confirm new password</label>
      <input
        id="confirm-password"
        type="password"
        autocomplete="new-password"
        minlength="8"
        required
        :value="confirmPassword"
        @input="emit('update:confirmPassword', ($event.target as HTMLInputElement).value)"
      />
    </div>
    <AppButton
      variant="primary"
      :icon="ShieldCheck"
      type="submit"
      :loading="busy"
      loading-label="Saving…"
      :disabled="!currentPassword || !newPassword || !confirmPassword"
    >
      Change password
    </AppButton>
  </form>
</template>
