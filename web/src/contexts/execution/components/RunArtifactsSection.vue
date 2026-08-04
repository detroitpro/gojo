<script setup lang="ts">
import type { Run, RunArtifactsResult } from "@/contexts/execution/types";

interface HandoffAssetView {
  role: string;
  label: string;
  path?: string;
  mediaType: string;
  content?: string;
}

defineProps<{
  run: Run | null;
  artifacts: RunArtifactsResult | null;
  handoffText: string | null;
  handoffAssets: HandoffAssetView[];
  artifactsHandoffText: string | null;
  artifactsValidationText: string | null;
}>();
</script>

<template>
  <section class="panel">
    <div class="panel-header">Artifacts</div>
    <div class="panel-body">
      <div v-if="!artifacts" class="muted">Loading…</div>
      <template v-else>
        <div class="mono">
          path={{ artifacts.path }}
          <br />
          exists={{ artifacts.exists }}
        </div>

        <div v-if="handoffAssets.length" class="mt-4">
          <div class="panel-subheader">Handoff assets</div>
          <ul class="handoff-assets">
            <li v-for="(asset, idx) in handoffAssets" :key="`${asset.role}-${idx}`">
              <div class="handoff-asset-meta">
                <span class="mono">{{ asset.role }}</span>
                <span class="muted">· {{ asset.label }}</span>
                <span v-if="asset.path" class="mono muted"> · {{ asset.path }}</span>
              </div>
              <pre
                v-if="asset.content"
                class="pre-block mt-2 activity-assistant-body"
              >{{ asset.content }}</pre>
            </li>
          </ul>
        </div>

        <pre v-if="artifactsHandoffText" class="pre-block mt-4">{{ artifactsHandoffText }}</pre>
        <div v-else class="muted mt-4">No handoff.json on disk</div>
        <pre v-if="artifactsValidationText" class="pre-block mt-4">{{ artifactsValidationText }}</pre>
        <div v-else-if="run?.errorMessage?.startsWith('Validation failed')" class="muted mt-4">
          No validation.json on disk
        </div>
      </template>
    </div>
  </section>

  <section class="panel">
    <div class="panel-header">Handoff JSON</div>
    <div class="panel-body">
      <pre v-if="handoffText" class="pre-block">{{ handoffText }}</pre>
      <div v-else class="muted">No handoff payload yet</div>
    </div>
  </section>
</template>
