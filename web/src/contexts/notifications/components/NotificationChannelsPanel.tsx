import { useEffect, useMemo, useState } from "react";
import { AppTextfield as Textfield } from "@/ui/AppTextfield";
import { AppSelect as Select } from "@/ui/AppSelect";
import { Pencil, Plus, Save, Send, Trash2 } from "lucide-react";

import {
  listNotificationChannels,
  putNotificationChannels,
  testNotificationChannel,
} from "@/contexts/notifications/contract";
import { AppButton } from "@/ui/AppButton";
import { ChannelTypeBadge } from "@/ui/status/ChannelTypeBadge";
import { SortableTh } from "@/ui/SortableTh";
import { TablePager } from "@/ui/TablePager";
import { useClientPager } from "@/platform/useClientPager";
import type {
  NotificationChannelConfig,
  NotificationChannelEntry,
  NotificationChannelMap,
  NotificationChannelType,
} from "@/contexts/notifications/types";

const CHANNEL_TYPES: NotificationChannelType[] = [
  "slack",
  "webhook",
  "discord",
  "teams",
  "telegram",
];

const TYPE_HELP: Record<NotificationChannelType, string> = {
  slack: "Create an Incoming Webhook in Slack (Apps → Incoming Webhooks) and paste the URL here.",
  webhook: "Any HTTPS endpoint that accepts a JSON POST body.",
  discord:
    "In Discord: Channel settings → Integrations → Webhooks → New Webhook → Copy Webhook URL.",
  teams: "In Teams: channel Connectors → Incoming Webhook → configure → copy the URL.",
  telegram:
    "Talk to @BotFather to create a bot and copy the token. Send a message to the bot, then open https://api.telegram.org/bot<token>/getUpdates and copy chat.id (groups are negative).",
};

function maskUrl(url: string): string {
  try {
    return `${new URL(url).host}/…`;
  } catch {
    return "invalid-url";
  }
}

function maskToken(token: string): string {
  if (token.length <= 8) return "••••";
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

function endpointLabel(entry: NotificationChannelEntry): string {
  if (entry.type === "telegram") {
    return `chat ${entry.chatId} · ${maskToken(entry.botToken)}`;
  }
  return maskUrl(entry.webhookUrl);
}

const namePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function NotificationChannelsPanel({
  initialChannels,
  onError,
  onMessage,
}: {
  initialChannels?: NotificationChannelMap;
  onError: (msg: string) => void;
  onMessage: (msg: string) => void;
}) {
  const [channels, setChannels] = useState<NotificationChannelMap>(initialChannels ?? {});
  const [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<NotificationChannelType>("slack");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [botToken, setBotToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [formError, setFormError] = useState("");
  const [testMessage, setTestMessage] = useState("");
  const [testOk, setTestOk] = useState(false);
  const [channelQuery, setChannelQuery] = useState("");

  useEffect(() => {
    if (initialChannels) setChannels({ ...initialChannels });
  }, [initialChannels]);

  const entries = useMemo<NotificationChannelEntry[]>(
    () =>
      Object.entries(channels).map(([channelName, config]) => ({
        name: channelName,
        ...config,
      })),
    [channels],
  );

  const filteredEntries = useMemo(() => {
    const q = channelQuery.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) => e.name.toLowerCase().includes(q) || e.type.toLowerCase().includes(q),
    );
  }, [entries, channelQuery]);

  const sorted = useMemo(() => {
    const arr = [...filteredEntries];
    // client sort applied in pager via setSort — keep default alpha order stable here
    return arr;
  }, [filteredEntries]);

  const pager = useClientPager(sorted, 25, { defaultSort: "name", defaultOrder: "asc" });

  const finalSorted = useMemo(() => {
    const arr = [...sorted];
    arr.sort((a, b) => {
      let cmp = 0;
      if (pager.sort === "name") cmp = a.name.localeCompare(b.name);
      else if (pager.sort === "type") cmp = a.type.localeCompare(b.type);
      return pager.order === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [sorted, pager.sort, pager.order]);

  const pageStart = pager.offset;
  const pageItems = finalSorted.slice(pageStart, pageStart + pager.pageSize);

  useEffect(() => {
    pager.setPage(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelQuery]);

  function resetForm() {
    setFormOpen(false);
    setEditingName(null);
    setName("");
    setType("slack");
    setWebhookUrl("");
    setBotToken("");
    setChatId("");
    setFormError("");
    setTestMessage("");
    setTestOk(false);
  }

  function openAdd() {
    resetForm();
    setFormOpen(true);
  }

  function openEdit(entry: NotificationChannelEntry) {
    setFormOpen(true);
    setEditingName(entry.name);
    setName(entry.name);
    setType(entry.type);
    if (entry.type === "telegram") {
      setBotToken(entry.botToken);
      setChatId(entry.chatId);
      setWebhookUrl("");
    } else {
      setWebhookUrl(entry.webhookUrl);
      setBotToken("");
      setChatId("");
    }
    setFormError("");
    setTestMessage("");
    setTestOk(false);
  }

  function currentConfig(): NotificationChannelConfig | null {
    if (type === "telegram") {
      const token = botToken.trim();
      const chat = chatId.trim();
      if (!token) {
        setFormError("Bot token is required");
        return null;
      }
      if (!chat) {
        setFormError("Chat ID is required");
        return null;
      }
      return { type: "telegram", botToken: token, chatId: chat };
    }
    const trimmedUrl = webhookUrl.trim();
    if (!trimmedUrl.startsWith("https://")) {
      setFormError("Webhook URL must start with https://");
      return null;
    }
    try {
      new URL(trimmedUrl);
    } catch {
      setFormError("Webhook URL is not a valid URL");
      return null;
    }
    return { type, webhookUrl: trimmedUrl };
  }

  async function persist(next: NotificationChannelMap) {
    setBusy(true);
    setFormError("");
    try {
      const saved = await putNotificationChannels(next);
      setChannels(saved);
      onMessage("Notification channels saved");
      resetForm();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save channels";
      setFormError(message);
      onError(message);
    } finally {
      setBusy(false);
    }
  }

  async function saveChannel() {
    const trimmedName = name.trim().toLowerCase();
    if (!trimmedName || !namePattern.test(trimmedName)) {
      setFormError(
        "Name must be lowercase letters, numbers, and hyphens (e.g. engineering-slack)",
      );
      return;
    }
    const config = currentConfig();
    if (!config) return;
    const next: NotificationChannelMap = { ...channels };
    if (editingName && editingName !== trimmedName) delete next[editingName];
    if (!editingName && next[trimmedName]) {
      setFormError(`Channel "${trimmedName}" already exists`);
      return;
    }
    next[trimmedName] = config;
    await persist(next);
  }

  async function removeChannel(channelName: string) {
    if (
      !confirm(`Delete channel "${channelName}"? Projects that reference it will stop notifying.`)
    ) {
      return;
    }
    const next = { ...channels };
    delete next[channelName];
    await persist(next);
  }

  async function sendTest(configOverride?: NotificationChannelConfig) {
    const config = configOverride ?? currentConfig();
    if (!config) return;
    setBusy(true);
    setFormError("");
    setTestMessage("");
    setTestOk(false);
    try {
      await testNotificationChannel(config);
      setTestOk(true);
      setTestMessage("Test notification delivered");
      onMessage("Test notification delivered");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Test delivery failed";
      setTestOk(false);
      setTestMessage(message);
      setFormError(message);
    } finally {
      setBusy(false);
    }
  }

  async function sendTestForRow(entry: NotificationChannelEntry) {
    if (entry.type === "telegram") {
      await sendTest({ type: "telegram", botToken: entry.botToken, chatId: entry.chatId });
      return;
    }
    await sendTest({ type: entry.type, webhookUrl: entry.webhookUrl });
  }

  async function reload() {
    setBusy(true);
    try {
      setChannels(await listNotificationChannels());
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to reload channels");
    } finally {
      setBusy(false);
    }
  }

  const isTelegram = type === "telegram";
  const typeHelp = TYPE_HELP[type];
  const typeOptions = CHANNEL_TYPES.map((t) => ({ value: t, label: t }));
  void reload;

  return (
    <section className="panel">
      <div className="panel-header">
        Notification channels
        <AppButton
          size="sm"
          disabled={busy}
          onClick={openAdd}
          iconBefore={<Plus size={12} />}
        >
          Add channel
        </AppButton>
      </div>
      <div className="panel-body">
        <p className="muted">
          Channels deliver run outcomes. Route them per project in{" "}
          <span className="mono">gojo.yaml</span> via{" "}
          <span className="mono">notifications.onSuccess</span> /{" "}
          <span className="mono">onFailure</span> / <span className="mono">onDisabled</span>.
          Telegram uses the Bot API (token + chat id); Slack/Discord/Teams use webhook URLs.
        </p>

        {entries.length === 0 && !formOpen ? (
          <div className="muted mt-5">No channels configured yet</div>
        ) : entries.length ? (
          <>
            <div className="inline-form mt-5 task-filters">
              <div className="field flex-2">
                <label htmlFor="channel-search">Search</label>
                <Textfield
                  id="channel-search"
                  value={channelQuery}
                  onChange={(e) => setChannelQuery(e.currentTarget.value)}
                  placeholder="Channel name, type…"
                  type="search"
                />
              </div>
            </div>
            {finalSorted.length === 0 ? (
              <div className="muted mt-5">No channels match these filters</div>
            ) : (
              <>
                <div className="table-wrap mt-5">
                  <table className="data">
                    <thead>
                      <tr>
                        <SortableTh
                          column="name"
                          label="Name"
                          sort={pager.sort}
                          order={pager.order}
                          onSort={pager.setSort}
                        />
                        <SortableTh
                          column="type"
                          label="Type"
                          sort={pager.sort}
                          order={pager.order}
                          onSort={pager.setSort}
                        />
                        <th>Endpoint</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {pageItems.map((entry) => (
                        <tr key={entry.name}>
                          <td className="mono">{entry.name}</td>
                          <td>
                            <ChannelTypeBadge type={entry.type} />
                          </td>
                          <td className="mono muted">{endpointLabel(entry)}</td>
                          <td>
                            <AppButton
                              size="sm"
                              disabled={busy}
                              onClick={() => void sendTestForRow(entry)}
                              iconBefore={<Send size={12} />}
                            >
                              Send test
                            </AppButton>{" "}
                            <AppButton
                              size="sm"
                              disabled={busy}
                              onClick={() => openEdit(entry)}
                              iconBefore={<Pencil size={12} />}
                            >
                              Edit
                            </AppButton>{" "}
                            <AppButton
                              variant="danger"
                              size="sm"
                              disabled={busy}
                              onClick={() => void removeChannel(entry.name)}
                              iconBefore={<Trash2 size={12} />}
                            >
                              Delete
                            </AppButton>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <TablePager
                  page={pager.page + 1}
                  pageCount={pager.pageCount}
                  rangeLabel={pager.rangeLabel}
                  total={finalSorted.length}
                  onPageChange={(p) => pager.setPage(p - 1)}
                />
              </>
            )}
          </>
        ) : null}

        {formOpen ? (
          <div className="channel-form mt-6">
            <div className="inline-form">
              <div className="field">
                <label htmlFor="channel-name">Name</label>
                <Textfield
                  id="channel-name"
                  value={name}
                  onChange={(e) => setName(e.currentTarget.value)}
                  placeholder="engineering-slack"
                  isDisabled={busy}
                />
              </div>
              <div className="field">
                <label htmlFor="channel-type">Type</label>
                <Select
                  inputId="channel-type"
                  value={typeOptions.find((o) => o.value === type)}
                  options={typeOptions}
                  onChange={(opt) => opt && setType(opt.value as NotificationChannelType)}
                  isDisabled={busy}
                  isSearchable={false}
                />
              </div>
              {!isTelegram ? (
                <div className="field flex-2">
                  <label htmlFor="channel-url">Webhook URL</label>
                  <Textfield
                    id="channel-url"
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.currentTarget.value)}
                    type="url"
                    placeholder="https://hooks.slack.com/services/…"
                    isDisabled={busy}
                  />
                </div>
              ) : (
                <>
                  <div className="field flex-2">
                    <label htmlFor="channel-bot-token">Bot token</label>
                    <Textfield
                      id="channel-bot-token"
                      value={botToken}
                      onChange={(e) => setBotToken(e.currentTarget.value)}
                      type="password"
                      autoComplete="off"
                      placeholder="123456:ABC…"
                      isDisabled={busy}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="channel-chat-id">Chat ID</label>
                    <Textfield
                      id="channel-chat-id"
                      value={chatId}
                      onChange={(e) => setChatId(e.currentTarget.value)}
                      placeholder="-1001234567890"
                      isDisabled={busy}
                    />
                  </div>
                </>
              )}
            </div>
            <p className="muted mt-3">{typeHelp}</p>
            {formError ? (
              <div className="alert alert-error mt-4">{formError}</div>
            ) : testMessage ? (
              <div className={`alert ${testOk ? "alert-info" : "alert-error"}`}>
                {testMessage}
              </div>
            ) : null}
            <div className="toolbar mt-4">
              <AppButton
                variant="primary"
                loading={busy}
                loadingLabel="Saving…"
                onClick={() => void saveChannel()}
                iconBefore={<Save size={12} />}
              >
                {editingName ? "Save changes" : "Save channel"}
              </AppButton>
              <AppButton
                disabled={busy}
                onClick={() => void sendTest()}
                iconBefore={<Send size={12} />}
              >
                Send test
              </AppButton>
              <AppButton disabled={busy} onClick={resetForm}>
                Cancel
              </AppButton>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
