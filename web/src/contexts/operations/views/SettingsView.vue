<script setup lang="ts">
import { ref } from "vue";

import { listNotificationChannels } from "@/contexts/notifications/contract";
import SettingsTokensSection from "@/contexts/access/components/SettingsTokensSection.vue";
import SettingsSchedulingSection from "@/contexts/scheduling/components/SettingsSchedulingSection.vue";
import SettingsBackupsSection from "@/contexts/operations/components/SettingsBackupsSection.vue";
import SettingsDoctorSection from "@/contexts/operations/components/SettingsDoctorSection.vue";
import SettingsInstanceSection from "@/contexts/operations/components/SettingsInstanceSection.vue";
import NotificationChannelsPanel from "@/contexts/notifications/components/NotificationChannelsPanel.vue";
import PageHeader from "@/ui/PageHeader.vue";
import StatGrid from "@/ui/StatGrid.vue";
import StatTile from "@/ui/StatTile.vue";
import type { NotificationChannelMap } from "@/contexts/notifications/types";

const instanceSection = ref<InstanceType<typeof SettingsInstanceSection> | null>(null);
const channels = ref<NotificationChannelMap>({});
const loading = ref(true);
const error = ref("");
const message = ref("");

async function loadChannels() {
  loading.value = true;
  error.value = "";
  try {
    channels.value = await listNotificationChannels();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to load settings";
  } finally {
    loading.value = false;
  }
}

function onSectionError(msg: string) {
  error.value = msg;
  message.value = "";
}

function onSectionMessage(msg: string) {
  message.value = msg;
  error.value = "";
}

function onChannelError(msg: string) {
  onSectionError(msg);
}

function onChannelMessage(msg: string) {
  onSectionMessage(msg);
}

void loadChannels();
</script>

<template>
  <div>
    <PageHeader title="Settings" subtitle="Instance configuration" />

    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div v-if="message" class="alert alert-info">{{ message }}</div>
    <div v-if="loading" class="empty">Loading…</div>

    <template v-else>
      <StatGrid v-if="instanceSection?.instance">
        <StatTile
          metric-key="settings.version"
          :value="instanceSection.health?.version ?? '—'"
        />
        <StatTile
          metric-key="settings.scheduler"
          :value="instanceSection.instance.paused ? 'Paused' : 'Active'"
        />
        <StatTile
          metric-key="settings.telemetry"
          :value="instanceSection.instance.telemetryEnabled ? 'On' : 'Off'"
        />
      </StatGrid>

      <SettingsInstanceSection
        ref="instanceSection"
        @error="onSectionError"
        @message="onSectionMessage"
      />
      <SettingsSchedulingSection @error="onSectionError" @message="onSectionMessage" />
      <SettingsDoctorSection @error="onSectionError" />
      <SettingsTokensSection @error="onSectionError" @message="onSectionMessage" />
      <NotificationChannelsPanel
        :initial-channels="channels"
        @error="onChannelError"
        @message="onChannelMessage"
      />
      <SettingsBackupsSection @error="onSectionError" @message="onSectionMessage" />
    </template>
  </div>
</template>
