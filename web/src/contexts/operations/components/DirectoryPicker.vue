<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { Check, FolderOpen, X } from "lucide-vue-next";

import AppButton from "@/ui/AppButton.vue";

import { browseFilesystem } from "@/contexts/operations/contract";
import type { BrowseRoot, DirectoryListing } from "@/contexts/operations/types";

const props = defineProps<{
  open: boolean;
  initialPath?: string;
}>();

const emit = defineEmits<{
  close: [];
  select: [path: string];
}>();

const listing = ref<DirectoryListing | null>(null);
const roots = ref<BrowseRoot[]>([]);
const loading = ref(false);
const error = ref("");
const selected = ref<string | null>(null);

async function load(path?: string) {
  loading.value = true;
  error.value = "";
  try {
    const result = await browseFilesystem(path);
    listing.value = result.listing;
    roots.value = result.roots;
    selected.value = result.listing.isGitRepo ? result.listing.path : null;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to browse filesystem";
  } finally {
    loading.value = false;
  }
}

function openEntry(path: string) {
  void load(path);
}

function chooseCurrent() {
  if (!listing.value) {
    return;
  }
  emit("select", selected.value ?? listing.value.path);
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    emit("close");
  }
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      selected.value = null;
      void load(props.initialPath);
    }
  },
);

onMounted(() => {
  if (props.open) {
    void load(props.initialPath);
  }
});
</script>

<template>
  <div
    v-if="open"
    class="picker-backdrop"
    role="dialog"
    aria-modal="true"
    aria-label="Choose repository directory"
    @keydown="onKeydown"
  >
    <div class="picker">
      <header class="picker-header">
        <div>
          <div class="picker-title">Choose repository</div>
          <div class="picker-path mono">{{ listing?.path ?? "…" }}</div>
        </div>
        <AppButton size="sm" :icon="X" @click="emit('close')">Close</AppButton>
      </header>

      <div class="picker-roots">
        <AppButton
          v-for="root in roots"
          :key="root.path"
          size="sm"
          :icon="FolderOpen"
          @click="openEntry(root.path)"
        >
          {{ root.label }}
        </AppButton>
      </div>

      <div v-if="error" class="alert alert-error">{{ error }}</div>

      <div class="picker-body">
        <button
          v-if="listing?.parent"
          class="picker-row"
          type="button"
          @click="openEntry(listing.parent)"
        >
          <span class="picker-icon">↑</span>
          <span>.. parent</span>
        </button>

        <div v-if="loading" class="empty">Loading…</div>
        <template v-else-if="listing">
          <button
            v-for="entry in listing.entries"
            :key="entry.path"
            class="picker-row"
            :class="{ selected: selected === entry.path, git: entry.isGitRepo }"
            type="button"
            @click="selected = entry.path"
            @dblclick="openEntry(entry.path)"
          >
            <span class="picker-icon">{{ entry.isGitRepo ? "●" : "▸" }}</span>
            <span class="picker-name">{{ entry.name }}</span>
            <span v-if="entry.isGitRepo" class="picker-badge">git</span>
            <span class="picker-open muted" @click.stop="openEntry(entry.path)">Open</span>
          </button>
          <div v-if="listing.entries.length === 0" class="empty">No subdirectories</div>
        </template>
      </div>

      <footer class="picker-footer">
        <div class="muted">
          <template v-if="selected">Selected: <span class="mono">{{ selected }}</span></template>
          <template v-else-if="listing?.isGitRepo">
            Current folder is a git repo — you can select it
          </template>
          <template v-else>Select a folder, or open into one (double-click)</template>
        </div>
        <div class="picker-actions">
          <AppButton :icon="X" @click="emit('close')">Cancel</AppButton>
          <AppButton
            variant="primary"
            :icon="Check"
            :disabled="!listing"
            @click="chooseCurrent"
          >
            Use this folder
          </AppButton>
        </div>
      </footer>
    </div>
  </div>
</template>
