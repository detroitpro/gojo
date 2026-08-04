<script setup lang="ts">
import { onMounted, onUnmounted, watch } from "vue";
import { Check, Trash2, X } from "lucide-vue-next";

import AppButton from "@/ui/AppButton.vue";

const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
    busy?: boolean;
    busyLabel?: string;
  }>(),
  {
    confirmLabel: "Confirm",
    cancelLabel: "Cancel",
    danger: false,
    busy: false,
    busyLabel: "Working…",
  },
);

const emit = defineEmits<{
  close: [];
  confirm: [];
}>();

function onKeydown(event: KeyboardEvent) {
  if (!props.open) {
    return;
  }
  if (event.key === "Escape" && !props.busy) {
    emit("close");
  }
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
  },
);

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
});

onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown);
  document.body.style.overflow = "";
});
</script>

<template>
  <div
    v-if="open"
    class="picker-backdrop"
    role="dialog"
    aria-modal="true"
    :aria-label="title"
    @click.self="!busy && emit('close')"
  >
    <div class="confirm-dialog">
      <header class="confirm-dialog-header">
        <div class="confirm-dialog-title">{{ title }}</div>
      </header>
      <div class="confirm-dialog-body">
        <slot />
      </div>
      <footer class="confirm-dialog-footer">
        <AppButton :icon="X" :disabled="busy" @click="emit('close')">
          {{ cancelLabel }}
        </AppButton>
        <AppButton
          :variant="danger ? 'danger' : 'primary'"
          :icon="danger ? Trash2 : Check"
          :loading="busy"
          :loading-label="busyLabel"
          @click="emit('confirm')"
        >
          {{ confirmLabel }}
        </AppButton>
      </footer>
    </div>
  </div>
</template>
