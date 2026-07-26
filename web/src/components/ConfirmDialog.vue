<script setup lang="ts">
import { onMounted, onUnmounted, watch } from "vue";

const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
  }>(),
  {
    confirmLabel: "Confirm",
    cancelLabel: "Cancel",
    danger: false,
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
  if (event.key === "Escape") {
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
    @click.self="emit('close')"
  >
    <div class="confirm-dialog">
      <header class="confirm-dialog-header">
        <div class="confirm-dialog-title">{{ title }}</div>
      </header>
      <div class="confirm-dialog-body">
        <slot />
      </div>
      <footer class="confirm-dialog-footer">
        <button class="btn" type="button" @click="emit('close')">{{ cancelLabel }}</button>
        <button
          class="btn"
          :class="danger ? 'btn-danger' : 'btn-primary'"
          type="button"
          @click="emit('confirm')"
        >
          {{ confirmLabel }}
        </button>
      </footer>
    </div>
  </div>
</template>
