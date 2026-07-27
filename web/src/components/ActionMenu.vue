<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
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
const panel = ref<HTMLElement | null>(null);
const panelStyle = ref<Record<string, string>>({});

const ariaLabel = computed(() => props.label ?? "Actions");

function triggerRect(): DOMRect | null {
  const trigger = root.value?.querySelector(".action-menu-trigger");
  return trigger instanceof HTMLElement ? trigger.getBoundingClientRect() : null;
}

function placePanel(rect: DOMRect, menuWidth: number, menuHeight: number) {
  const gap = 4;
  const pad = 8;

  let top = rect.bottom + gap;
  if (top + menuHeight > window.innerHeight - pad && rect.top - gap - menuHeight >= pad) {
    top = rect.top - gap - menuHeight;
  }

  let left = rect.right - menuWidth;
  left = Math.min(left, window.innerWidth - pad - menuWidth);
  left = Math.max(pad, left);

  panelStyle.value = {
    top: `${Math.round(top)}px`,
    left: `${Math.round(left)}px`,
  };
}

async function positionPanel() {
  const rect = triggerRect();
  if (!rect) {
    return;
  }
  // Rough place before paint so the menu does not flash at 0,0.
  placePanel(rect, 144, 160);
  await nextTick();
  const el = panel.value;
  if (!el) {
    return;
  }
  placePanel(rect, el.offsetWidth, el.offsetHeight);
}

async function toggle() {
  if (props.disabled) {
    return;
  }
  if (open.value) {
    open.value = false;
    return;
  }
  open.value = true;
  await positionPanel();
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
  if (!open.value) {
    return;
  }
  const target = event.target as Node | null;
  if (!target) {
    return;
  }
  if (root.value?.contains(target) || panel.value?.contains(target)) {
    return;
  }
  close();
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    close();
  }
}

function onReposition() {
  if (open.value) {
    void positionPanel();
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

watch(
  () => props.items,
  () => {
    if (open.value) {
      void positionPanel();
    }
  },
);

onMounted(() => {
  document.addEventListener("click", onDocClick);
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("resize", onReposition);
  window.addEventListener("scroll", onReposition, true);
});

onUnmounted(() => {
  document.removeEventListener("click", onDocClick);
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("resize", onReposition);
  window.removeEventListener("scroll", onReposition, true);
});
</script>

<template>
  <div ref="root" class="action-menu">
    <button
      class="btn btn-sm action-menu-trigger"
      type="button"
      :disabled="disabled"
      :aria-expanded="open"
      :aria-haspopup="true"
      :aria-label="ariaLabel"
      @click.stop="toggle"
    >
      ⋯
    </button>
    <Teleport to="body">
      <div
        v-if="open"
        ref="panel"
        class="action-menu-panel action-menu-panel-floating"
        role="menu"
        :style="panelStyle"
      >
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
    </Teleport>
  </div>
</template>
