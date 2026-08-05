<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";

import type { Agent, Project, ProjectSyncResult } from "@/contexts/catalog/types";
import { parseManifestView } from "@/kernel/project-manifest";

const props = defineProps<{
  project: Project;
  agents: Agent[];
  lastSync: ProjectSyncResult | null;
}>();

const manifest = computed(() => parseManifestView(props.project.manifestJson));

const agentsByName = computed(() => {
  const map = new Map<string, Agent>();
  for (const agent of props.agents) {
    map.set(agent.name, agent);
  }
  return map;
});
</script>

<template>
  <section class="panel mb-7">
    <div class="panel-header">Sync</div>
    <div class="panel-body">
      <p class="muted">
        Sync reads <span class="mono">gojo.yaml</span> (or
        <span class="mono">.gojo/project.yaml</span>) and upserts profiles, agents, and
        schedules by name. Entries removed from the manifest are soft-disabled so they stop
        firing. Sync does not change git history or your working tree. Use
        <strong>Sync</strong> in the page header to run it.
      </p>
      <div v-if="lastSync" class="mt-5 project-sync-result">
        <div>
          Manifest:
          <span class="mono">{{ lastSync.manifestPath ?? "not found" }}</span>
        </div>
        <div class="muted mt-2">
          {{ lastSync.profiles }} profiles · {{ lastSync.agents }} agents ·
          {{ lastSync.schedules }} schedules
        </div>
      </div>
    </div>
  </section>

  <section class="panel mb-7">
    <div class="panel-header">Configuration</div>
    <div class="panel-body">
      <div v-if="!project.hasManifest" class="muted">
        No synced manifest yet. Run Sync after adding a
        <span class="mono">gojo.yaml</span>.
      </div>
      <template v-else-if="!manifest.ok">
        <div class="alert alert-error">Could not parse manifest: {{ manifest.error }}</div>
      </template>
      <template v-else>
        <div v-if="Object.keys(manifest.repository).length" class="mb-7">
          <div class="panel-subheader">Repository</div>
          <ul class="project-kv">
            <li v-for="(value, key) in manifest.repository" :key="key">
              <span class="mono">{{ key }}</span>
              <span class="muted">{{ String(value) }}</span>
            </li>
          </ul>
        </div>

        <div class="mb-7">
          <div class="panel-subheader">Profiles ({{ manifest.profiles.length }})</div>
          <div v-if="manifest.profiles.length === 0" class="muted">None</div>
          <div v-else class="table-wrap">
            <table class="data">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Adapter</th>
                  <th>Model</th>
                  <th>Timeout</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="profile in manifest.profiles" :key="profile.name">
                  <td class="entity-name">{{ profile.name }}</td>
                  <td class="mono">{{ profile.adapter }}</td>
                  <td class="mono muted">{{ profile.model ?? "—" }}</td>
                  <td class="mono muted">{{ profile.timeout ?? "—" }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="mb-7">
          <div class="panel-subheader">Agents ({{ manifest.agents.length }})</div>
          <div v-if="manifest.agents.length === 0" class="muted">None</div>
          <div v-else class="table-wrap">
            <table class="data">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Profile</th>
                  <th>Integration</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="agent in manifest.agents" :key="agent.name">
                  <td>
                    <RouterLink
                      v-if="agentsByName.get(agent.name)"
                      :to="{
                        name: 'agent-detail',
                        params: { id: agentsByName.get(agent.name)!.id },
                      }"
                      class="entity-name"
                    >
                      {{ agent.name }}
                    </RouterLink>
                    <span v-else class="entity-name">{{ agent.name }}</span>
                  </td>
                  <td class="mono">{{ agent.profile }}</td>
                  <td class="mono">{{ agent.integrationMode }}</td>
                  <td class="muted">{{ agent.description || "—" }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="mb-7">
          <div class="panel-subheader">Schedules ({{ manifest.schedules.length }})</div>
          <div v-if="manifest.schedules.length === 0" class="muted">None</div>
          <div v-else class="table-wrap">
            <table class="data">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Agent</th>
                  <th>Cron</th>
                  <th>Timezone</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="schedule in manifest.schedules" :key="schedule.name">
                  <td class="entity-name">{{ schedule.name }}</td>
                  <td class="mono">{{ schedule.agent }}</td>
                  <td class="mono">{{ schedule.cron }}</td>
                  <td class="mono muted">{{ schedule.timezone }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="mb-7">
          <div class="panel-subheader">
            Validation profiles ({{ manifest.validationProfiles.length }})
          </div>
          <div v-if="manifest.validationProfiles.length === 0" class="muted">None</div>
          <ul v-else class="project-kv">
            <li v-for="profile in manifest.validationProfiles" :key="profile.name">
              <span class="mono">{{ profile.name }}</span>
              <span class="muted">{{ profile.stepCount }} steps</span>
            </li>
          </ul>
        </div>

        <details class="project-raw-json">
          <summary class="muted">Advanced: raw JSON</summary>
          <pre class="pre-block">{{ manifest.prettyJson }}</pre>
        </details>
      </template>
    </div>
  </section>
</template>
