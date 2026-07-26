<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";

export type ActionMenuItem = {
  id: string;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  to?: { name: string; params?: Record<string, string>; query?: Record<string, string> };
};

const props = defineProps<{
  items: ActionMenuItem[];
  disabled?: boolean;
  label?: string;
}>();

const emit = defineEmits<{
  select: [id: string];
}>();

const open = ref(false);
const root = ref<HTMLElement | null>(null);

const ariaLabel = computed(() => props.label ?? "Actions");

function toggle() {
  if (props.disabled) {
    return;
  }
  open.value = !open.value;
}

function close() {
  open.value = false;
}

function onSelect(item: ActionMenuItem) {
  if (item.disabled) {
    return;
  }
  close();
  if (!item.to) {
    emit("select", item.id);
  }
}

function onDocClick(event: MouseEvent) {
  if (!open.value || !root.value) {
    return;
  }
  const target = event.target as Node | null;
  if (target && !root.value.contains(target)) {
    close();
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    close();
  }
}

watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) {
      close();
    }
  },
);

onMounted(() => {
  document.addEventListener("click", onDocClick);
  window.addEventListener("keydown", onKeydown);
});

onUnmounted(() => {
  document.removeEventListener("click", onDocClick);
  window.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <div ref="root" class="action-menu">
    <button
      class="btn btn-sm action-menu-trigger"
      type="button"
      :disabled="disabled"
      :aria-expanded="open"
      :aria-label="ariaLabel"
      @click.stop="toggle"
    >
      ⋯
    </button>
    <div v-if="open" class="action-menu-panel" role="menu">
      <template v-for="item in items" :key="item.id">
        <RouterLink
          v-if="item.to"
          :to="item.to"
          class="action-menu-item"
          :class="{ danger: item.danger, disabled: item.disabled }"
          role="menuitem"
          @click="onSelect(item)"
        >
          {{ item.label }}
        </RouterLink>
        <button
          v-else
          class="action-menu-item"
          :class="{ danger: item.danger, disabled: item.disabled }"
          type="button"
          role="menuitem"
          :disabled="item.disabled"
          @click="onSelect(item)"
        >
          {{ item.label }}
        </button>
      </template>
    </div>
  </div>
</template>
