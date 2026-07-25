<script setup lang="ts">
import { computed, ref, watch } from "vue";

import {
  listNotificationChannels,
  putNotificationChannels,
  testNotificationChannel,
} from "@/api";
import TablePager from "@/components/TablePager.vue";
import { useClientPager } from "@/composables/useClientPager";
import type {
  NotificationChannelConfig,
  NotificationChannelEntry,
  NotificationChannelMap,
  NotificationChannelType,
} from "@/types";

const CHANNEL_TYPES: NotificationChannelType[] = [
  "slack",
  "webhook",
  "discord",
  "teams",
  "telegram",
];

const TYPE_HELP: Record<NotificationChannelType, string> = {
  slack:
    "Create an Incoming Webhook in Slack (Apps → Incoming Webhooks) and paste the URL here.",
  webhook: "Any HTTPS endpoint that accepts a JSON POST body.",
  discord:
    "In Discord: Channel settings → Integrations → Webhooks → New Webhook → Copy Webhook URL.",
  teams:
    "In Teams: channel Connectors → Incoming Webhook → configure → copy the URL.",
  telegram:
    "Talk to @BotFather to create a bot and copy the token. Send a message to the bot, then open https://api.telegram.org/bot<token>/getUpdates and copy chat.id (groups are negative).",
};

const props = defineProps<{
  initialChannels?: NotificationChannelMap;
}>();

const emit = defineEmits<{
  error: [message: string];
  message: [message: string];
}>();

const channels = ref<NotificationChannelMap>({});
const busy = ref(false);
const formOpen = ref(false);
const editingName = ref<string | null>(null);
const name = ref("");
const type = ref<NotificationChannelType>("slack");
const webhookUrl = ref("");
const botToken = ref("");
const chatId = ref("");
const formError = ref("");
const testMessage = ref("");
const testOk = ref(false);

const channelQuery = ref("");

const entries = computed<NotificationChannelEntry[]>(() =>
  Object.entries(channels.value)
    .map(([channelName, config]) => ({ name: channelName, ...config }))
    .sort((a, b) => a.name.localeCompare(b.name)),
);

const filteredEntries = computed(() => {
  const q = channelQuery.value.trim().toLowerCase();
  if (!q) {
    return entries.value;
  }
  return entries.value.filter(
    (entry) =>
      entry.name.toLowerCase().includes(q) || entry.type.toLowerCase().includes(q),
  );
});

const {
  page: channelPage,
  pages: channelPages,
  pageItems: channelItems,
  total: channelTotal,
  rangeLabel: channelRange,
  reset: resetChannelPage,
} = useClientPager(filteredEntries, 25);

watch(channelQuery, () => resetChannelPage());

const typeHelp = computed(() => TYPE_HELP[type.value]);
const isTelegram = computed(() => type.value === "telegram");

const namePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

watch(
  () => props.initialChannels,
  (value) => {
    channels.value = { ...(value ?? {}) };
  },
  { immediate: true },
);

function maskUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}/…`;
  } catch {
    return "invalid-url";
  }
}

function maskToken(token: string): string {
  if (token.length <= 8) {
    return "••••";
  }
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

function endpointLabel(entry: NotificationChannelEntry): string {
  if (entry.type === "telegram") {
    return `chat ${entry.chatId} · ${maskToken(entry.botToken)}`;
  }
  return maskUrl(entry.webhookUrl);
}

function resetForm() {
  formOpen.value = false;
  editingName.value = null;
  name.value = "";
  type.value = "slack";
  webhookUrl.value = "";
  botToken.value = "";
  chatId.value = "";
  formError.value = "";
  testMessage.value = "";
  testOk.value = false;
}

function openAdd() {
  resetForm();
  formOpen.value = true;
}

function openEdit(entry: NotificationChannelEntry) {
  formOpen.value = true;
  editingName.value = entry.name;
  name.value = entry.name;
  type.value = entry.type;
  if (entry.type === "telegram") {
    botToken.value = entry.botToken;
    chatId.value = entry.chatId;
    webhookUrl.value = "";
  } else {
    webhookUrl.value = entry.webhookUrl;
    botToken.value = "";
    chatId.value = "";
  }
  formError.value = "";
  testMessage.value = "";
  testOk.value = false;
}

function currentConfig(): NotificationChannelConfig | null {
  if (type.value === "telegram") {
    const token = botToken.value.trim();
    const chat = chatId.value.trim();
    if (!token) {
      formError.value = "Bot token is required";
      return null;
    }
    if (!chat) {
      formError.value = "Chat ID is required";
      return null;
    }
    return { type: "telegram", botToken: token, chatId: chat };
  }

  const trimmedUrl = webhookUrl.value.trim();
  if (!trimmedUrl.startsWith("https://")) {
    formError.value = "Webhook URL must start with https://";
    return null;
  }
  try {
    new URL(trimmedUrl);
  } catch {
    formError.value = "Webhook URL is not a valid URL";
    return null;
  }
  return {
    type: type.value,
    webhookUrl: trimmedUrl,
  };
}

async function persist(next: NotificationChannelMap) {
  busy.value = true;
  formError.value = "";
  try {
    channels.value = await putNotificationChannels(next);
    emit("message", "Notification channels saved");
    resetForm();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save channels";
    formError.value = message;
    emit("error", message);
  } finally {
    busy.value = false;
  }
}

async function saveChannel() {
  const trimmedName = name.value.trim().toLowerCase();
  if (!trimmedName || !namePattern.test(trimmedName)) {
    formError.value =
      "Name must be lowercase letters, numbers, and hyphens (e.g. engineering-slack)";
    return;
  }

  const config = currentConfig();
  if (!config) {
    return;
  }

  const next: NotificationChannelMap = { ...channels.value };
  if (editingName.value && editingName.value !== trimmedName) {
    delete next[editingName.value];
  }
  if (!editingName.value && next[trimmedName]) {
    formError.value = `Channel “${trimmedName}” already exists`;
    return;
  }
  next[trimmedName] = config;
  await persist(next);
}

async function removeChannel(channelName: string) {
  if (
    !confirm(
      `Delete channel “${channelName}”? Projects that reference it will stop notifying.`,
    )
  ) {
    return;
  }
  const next = { ...channels.value };
  delete next[channelName];
  await persist(next);
}

async function sendTest(configOverride?: NotificationChannelConfig) {
  const config = configOverride ?? currentConfig();
  if (!config) {
    return;
  }
  busy.value = true;
  formError.value = "";
  testMessage.value = "";
  testOk.value = false;
  try {
    await testNotificationChannel(config);
    testOk.value = true;
    testMessage.value = "Test notification delivered";
    emit("message", "Test notification delivered");
  } catch (err) {
    testOk.value = false;
    const message = err instanceof Error ? err.message : "Test delivery failed";
    testMessage.value = message;
    formError.value = message;
  } finally {
    busy.value = false;
  }
}

async function sendTestForRow(entry: NotificationChannelEntry) {
  if (entry.type === "telegram") {
    await sendTest({
      type: "telegram",
      botToken: entry.botToken,
      chatId: entry.chatId,
    });
    return;
  }
  await sendTest({ type: entry.type, webhookUrl: entry.webhookUrl });
}

async function reload() {
  busy.value = true;
  try {
    channels.value = await listNotificationChannels();
  } catch (err) {
    emit("error", err instanceof Error ? err.message : "Failed to reload channels");
  } finally {
    busy.value = false;
  }
}

defineExpose({ reload });
</script>

<template>
  <section class="panel">
    <div class="panel-header">
      Notification channels
      <button class="btn btn-sm" type="button" :disabled="busy" @click="openAdd">
        Add channel
      </button>
    </div>
    <div class="panel-body">
      <p class="muted">
        Channels deliver run outcomes. Route them per project in
        <span class="mono">gojo.yaml</span>
        via
        <span class="mono">notifications.onSuccess</span>
        /
        <span class="mono">onFailure</span>
        /
        <span class="mono">onDisabled</span>.
        Telegram uses the Bot API (token + chat id); Slack/Discord/Teams use webhook URLs.
      </p>

      <div v-if="entries.length === 0 && !formOpen" class="muted mt-5">
        No channels configured yet
      </div>

      <template v-else-if="entries.length">
        <div class="inline-form mt-5 task-filters">
          <div class="field flex-2">
            <label for="channel-search">Search</label>
            <input
              id="channel-search"
              v-model="channelQuery"
              class="input"
              type="search"
              placeholder="Channel name, type…"
            />
          </div>
        </div>
        <div v-if="channelTotal === 0" class="muted mt-5">No channels match these filters</div>
        <template v-else>
          <div class="table-wrap mt-5">
            <table class="data">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Endpoint</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="entry in channelItems" :key="entry.name">
                  <td class="mono">{{ entry.name }}</td>
                  <td>
                    <span class="badge badge-neutral">{{ entry.type }}</span>
                  </td>
                  <td class="mono muted">{{ endpointLabel(entry) }}</td>
                  <td>
                    <button
                      class="btn btn-sm"
                      type="button"
                      :disabled="busy"
                      @click="sendTestForRow(entry)"
                    >
                      Send test
                    </button>
                    <button
                      class="btn btn-sm"
                      type="button"
                      :disabled="busy"
                      @click="openEdit(entry)"
                    >
                      Edit
                    </button>
                    <button
                      class="btn btn-sm btn-danger"
                      type="button"
                      :disabled="busy"
                      @click="removeChannel(entry.name)"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <TablePager
            v-model:page="channelPage"
            :page-count="channelPages"
            :range-label="channelRange"
            :total="channelTotal"
          />
        </template>
      </template>

      <div v-if="formOpen" class="channel-form mt-6">
        <div class="inline-form">
          <div class="field">
            <label for="channel-name">Name</label>
            <input
              id="channel-name"
              v-model="name"
              class="mono"
              placeholder="engineering-slack"
              :disabled="busy"
              required
            />
          </div>
          <div class="field">
            <label for="channel-type">Type</label>
            <select id="channel-type" v-model="type" :disabled="busy">
              <option v-for="option in CHANNEL_TYPES" :key="option" :value="option">
                {{ option }}
              </option>
            </select>
          </div>
          <div v-if="!isTelegram" class="field flex-2">
            <label for="channel-url">Webhook URL</label>
            <input
              id="channel-url"
              v-model="webhookUrl"
              class="mono"
              type="url"
              placeholder="https://hooks.slack.com/services/…"
              :disabled="busy"
              required
            />
          </div>
          <template v-else>
            <div class="field flex-2">
              <label for="channel-bot-token">Bot token</label>
              <input
                id="channel-bot-token"
                v-model="botToken"
                class="mono"
                type="password"
                autocomplete="off"
                placeholder="123456:ABC…"
                :disabled="busy"
                required
              />
            </div>
            <div class="field">
              <label for="channel-chat-id">Chat ID</label>
              <input
                id="channel-chat-id"
                v-model="chatId"
                class="mono"
                placeholder="-1001234567890"
                :disabled="busy"
                required
              />
            </div>
          </template>
        </div>
        <p class="muted mt-3">{{ typeHelp }}</p>
        <div v-if="formError" class="alert alert-error mt-4">{{ formError }}</div>
        <div
          v-else-if="testMessage"
          class="alert"
          :class="testOk ? 'alert-info' : 'alert-error'"
        >
          {{ testMessage }}
        </div>
        <div class="toolbar mt-4">
          <button class="btn btn-primary" type="button" :disabled="busy" @click="saveChannel">
            {{ editingName ? "Save changes" : "Save channel" }}
          </button>
          <button class="btn" type="button" :disabled="busy" @click="sendTest()">
            Send test
          </button>
          <button class="btn" type="button" :disabled="busy" @click="resetForm">Cancel</button>
        </div>
      </div>
    </div>
  </section>
</template>
