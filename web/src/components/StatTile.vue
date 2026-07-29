<script setup lang="ts">
import { computed } from "vue";
import { RouterLink, type RouteLocationRaw } from "vue-router";

import MetricDelta from "@/components/MetricDelta.vue";
import UiIcon from "@/components/UiIcon.vue";
import { formatMergeRate } from "@/lib/impact-format";
import {
  impactCategorySpec,
  METRICS,
  metricAriaLabel,
  metricDelta,
  metricTone,
} from "@/lib/stat-metrics";

const props = defineProps<{
  metricKey: string;
  value: string | number | null;
  previous?: number | null;
  compareLabel?: string;
  to?: RouteLocationRaw;
  href?: string;
}>();

const IMPACT_CATEGORY_PREFIX = "impact.category.";

const spec = computed(() => {
  if (props.metricKey.startsWith(IMPACT_CATEGORY_PREFIX)) {
    return impactCategorySpec(props.metricKey.slice(IMPACT_CATEGORY_PREFIX.length));
  }
  return METRICS[props.metricKey];
});

const numericValue = computed(() =>
  typeof props.value === "number" ? props.value : null,
);

const displayValue = computed(() => {
  if (props.value === null || props.value === undefined) {
    return "—";
  }
  if (typeof props.value === "string") {
    return props.value;
  }
  const s = spec.value;
  if (s?.kind === "ratio") {
    return formatMergeRate(props.value);
  }
  return String(props.value);
});

const delta = computed(() => {
  if (numericValue.value === null) {
    return null;
  }
  return metricDelta(numericValue.value, props.previous);
});

const tone = computed(() => {
  const s = spec.value;
  if (!s) {
    return "neutral";
  }
  return metricTone(s, numericValue.value ?? props.value ?? 0);
});

const showAttentionFlag = computed(() => {
  const s = spec.value;
  return s?.attention && numericValue.value !== null && numericValue.value > 0;
});

const ariaLabel = computed(() => {
  const s = spec.value;
  if (!s) {
    return displayValue.value;
  }
  return metricAriaLabel(s, displayValue.value, delta.value, props.compareLabel);
});

const rootTag = computed(() => {
  if (props.to) {
    return RouterLink;
  }
  if (props.href) {
    return "a";
  }
  return "div";
});

const rootProps = computed(() => {
  if (props.to) {
    return { to: props.to };
  }
  if (props.href) {
    return { href: props.href };
  }
  return {};
});
</script>

<template>
  <component
    :is="rootTag"
    class="stat-tile"
    :class="`stat-tile--${tone}`"
    v-bind="rootProps"
    :aria-label="ariaLabel"
    :title="spec?.hint"
  >
    <span v-if="showAttentionFlag" class="stat-tile__flag" aria-hidden="true" />
    <div class="stat-tile__header">
      <span class="stat-tile__icon" aria-hidden="true">
        <UiIcon v-if="spec" :icon="spec.icon" :size="16" />
      </span>
      <span class="stat-tile__label">{{ spec?.label ?? metricKey }}</span>
    </div>
    <span class="stat-tile__value">{{ displayValue }}</span>
    <MetricDelta
      v-if="spec && delta !== null"
      :delta="delta"
      :direction="spec.direction"
      :title="compareLabel"
    />
  </component>
</template>
