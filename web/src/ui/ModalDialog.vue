<script setup lang="ts">
import { onMounted, onUnmounted, watch } from "vue";

const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    wide?: boolean;
    closeOnEscape?: boolean;
    closeOnBackdrop?: boolean;
  }>(),
  {
    wide: false,
    closeOnEscape: true,
    closeOnBackdrop: true,
  },
);

const emit = defineEmits<{
  close: [];
}>();

function onKeydown(event: KeyboardEvent) {
  if (!props.open || !props.closeOnEscape) {
    return;
  }
  if (event.key === "Escape") {
    emit("close");
  }
}

function onBackdropClick() {
  if (props.closeOnBackdrop) {
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
    @click.self="onBackdropClick"
  >
    <div class="confirm-dialog" :class="{ 'confirm-dialog-wide': wide }">
      <header class="confirm-dialog-header">
        <div class="confirm-dialog-title">{{ title }}</div>
      </header>
      <div class="confirm-dialog-body">
        <slot />
      </div>
      <footer v-if="$slots.footer" class="confirm-dialog-footer">
        <slot name="footer" />
      </footer>
    </div>
  </div>
</template>
