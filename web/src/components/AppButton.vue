<script setup lang="ts">
import type { Component } from "vue";
import { computed, useAttrs, useSlots } from "vue";
import { RouterLink } from "vue-router";
import { Loader } from "lucide-vue-next";

import UiIcon from "@/components/UiIcon.vue";

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    variant?: "primary" | "secondary" | "danger" | "ghost";
    size?: "sm" | "md";
    icon?: Component | null;
    loading?: boolean;
    loadingLabel?: string;
    disabled?: boolean;
    selected?: boolean;
    type?: "button" | "submit" | "reset";
    to?: string | Record<string, unknown>;
    href?: string;
    target?: string;
    rel?: string;
    ariaLabel?: string;
  }>(),
  {
    variant: "secondary",
    size: "md",
    icon: null,
    loading: false,
    loadingLabel: "",
    disabled: false,
    selected: false,
    type: "button",
  },
);

const emit = defineEmits<{
  click: [event: MouseEvent];
}>();

const attrs = useAttrs();
const slots = useSlots();

const isDisabled = computed(() => props.disabled || props.loading);
const displayIcon = computed(() => (props.loading ? Loader : props.icon));
const showLoadingLabel = computed(
  () => props.loading && props.loadingLabel.trim().length > 0,
);
const hasSlotLabel = computed(() => Boolean(slots.default));
const iconOnly = computed(
  () => !showLoadingLabel.value && !hasSlotLabel.value && Boolean(displayIcon.value),
);

const classes = computed(() => [
  "btn",
  {
    "btn-primary": props.variant === "primary",
    "btn-danger": props.variant === "danger",
    "btn-ghost": props.variant === "ghost",
    "btn-sm": props.size === "sm",
    "btn-selected": props.selected,
    "btn--icon-only": iconOnly.value,
  },
  attrs.class,
]);

const forwardedAttrs = computed(() => {
  const { class: _class, ...rest } = attrs as Record<string, unknown>;
  return rest;
});

function onClick(event: MouseEvent) {
  if (isDisabled.value) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  emit("click", event);
}
</script>

<template>
  <RouterLink
    v-if="to != null"
    v-bind="forwardedAttrs"
    :to="(to as string | Record<string, unknown>)"
    :class="classes"
    :aria-disabled="isDisabled || undefined"
    :aria-busy="loading || undefined"
    :aria-label="ariaLabel"
    :tabindex="isDisabled ? -1 : undefined"
    @click="onClick"
  >
    <UiIcon
      v-if="displayIcon"
      :icon="displayIcon"
      class="btn__icon"
      :class="{ 'btn__icon--spin': loading }"
      :size="size === 'sm' ? 12 : 14"
    />
    <span v-if="showLoadingLabel" class="btn__label">{{ loadingLabel }}</span>
    <span v-else-if="hasSlotLabel" class="btn__label"><slot /></span>
  </RouterLink>
  <a
    v-else-if="href"
    v-bind="forwardedAttrs"
    :href="isDisabled ? undefined : href"
    :class="classes"
    :target="target"
    :rel="rel ?? (target === '_blank' ? 'noopener noreferrer' : undefined)"
    :aria-disabled="isDisabled || undefined"
    :aria-busy="loading || undefined"
    :aria-label="ariaLabel"
    @click="onClick"
  >
    <UiIcon
      v-if="displayIcon"
      :icon="displayIcon"
      class="btn__icon"
      :class="{ 'btn__icon--spin': loading }"
      :size="size === 'sm' ? 12 : 14"
    />
    <span v-if="showLoadingLabel" class="btn__label">{{ loadingLabel }}</span>
    <span v-else-if="hasSlotLabel" class="btn__label"><slot /></span>
  </a>
  <button
    v-else
    v-bind="forwardedAttrs"
    :class="classes"
    :type="type"
    :disabled="isDisabled"
    :aria-busy="loading || undefined"
    :aria-label="ariaLabel"
    @click="onClick"
  >
    <UiIcon
      v-if="displayIcon"
      :icon="displayIcon"
      class="btn__icon"
      :class="{ 'btn__icon--spin': loading }"
      :size="size === 'sm' ? 12 : 14"
    />
    <span v-if="showLoadingLabel" class="btn__label">{{ loadingLabel }}</span>
    <span v-else-if="hasSlotLabel" class="btn__label"><slot /></span>
  </button>
</template>
