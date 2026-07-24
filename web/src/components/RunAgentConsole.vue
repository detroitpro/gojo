<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";

import type { AgentOutputEventData, RunEvent } from "@/types";

const MAX_BUFFER_CHARS = 200_000;

const props = defineProps<{
  events: RunEvent[];
}>();

const paused = ref(false);
const stickToBottom = ref(true);
const scroller = ref<HTMLElement | null>(null);

interface ConsoleLine {
  stream: "stdout" | "stderr";
  text: string;
}

const lines = computed(() => {
  const chunks: ConsoleLine[] = [];

  for (const event of props.events) {
    if (event.type !== "run.agent.output" || !event.data || typeof event.data !== "object") {
      continue;
    }
    const data = event.data as AgentOutputEventData;
    if (!data.chunk) {
      continue;
    }
    chunks.push({
      stream: data.stream === "stderr" ? "stderr" : "stdout",
      text: data.chunk,
    });
  }

  let total = chunks.reduce((sum, c) => sum + c.text.length, 0);
  let start = 0;
  while (total > MAX_BUFFER_CHARS && start < chunks.length) {
    total -= chunks[start]!.text.length;
    start += 1;
  }
  const trimmed = chunks.slice(start);

  const blocks: ConsoleLine[] = [];
  for (const chunk of trimmed) {
    const last = blocks[blocks.length - 1];
    if (last && last.stream === chunk.stream) {
      last.text += chunk.text;
    } else {
      blocks.push({ stream: chunk.stream, text: chunk.text });
    }
  }

  return blocks;
});

const hasOutput = computed(() => lines.value.some((line) => line.text.length > 0));

watch(
  () => props.events.length,
  async () => {
    if (paused.value || !stickToBottom.value) {
      return;
    }
    await nextTick();
    if (scroller.value) {
      scroller.value.scrollTop = scroller.value.scrollHeight;
    }
  },
);

function onScroll() {
  const el = scroller.value;
  if (!el) {
    return;
  }
  const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
  stickToBottom.value = distance < 48;
}
</script>

<template>
  <div class="agent-console">
    <div class="agent-console-toolbar">
      <button class="btn btn-sm" type="button" @click="paused = !paused">
        {{ paused ? "Resume scroll" : "Pause scroll" }}
      </button>
      <span class="muted">{{ hasOutput ? "Live agent output" : "No agent output yet" }}</span>
    </div>
    <div ref="scroller" class="agent-console-body" @scroll="onScroll">
      <template v-if="hasOutput">
        <pre
          v-for="(block, idx) in lines"
          :key="idx"
          class="console-block"
          :class="block.stream === 'stderr' ? 'console-stderr' : 'console-stdout'"
          >{{ block.text }}</pre
        >
      </template>
      <div v-else class="muted console-empty">Agent stdout/stderr will stream here while Running.</div>
    </div>
  </div>
</template>
