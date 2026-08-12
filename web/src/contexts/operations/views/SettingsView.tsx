import { useCallback, useEffect, useRef, useState } from "react";

import { listNotificationChannels } from "@/contexts/notifications/contract";
import { NotificationChannelsPanel } from "@/contexts/notifications/components/NotificationChannelsPanel";
import { SettingsBackupsSection } from "@/contexts/operations/components/SettingsBackupsSection";
import { SettingsDoctorSection } from "@/contexts/operations/components/SettingsDoctorSection";
import {
  SettingsInstanceSection,
  type SettingsInstanceSectionHandle,
} from "@/contexts/operations/components/SettingsInstanceSection";
import { SettingsSchedulingSection } from "@/contexts/scheduling/components/SettingsSchedulingSection";
import { SettingsTokensSection } from "@/contexts/access/components/SettingsTokensSection";
import { PageHeader } from "@/ui/PageHeader";
import { StatGrid } from "@/ui/StatGrid";
import { StatTile } from "@/ui/StatTile";
import type { NotificationChannelMap } from "@/contexts/notifications/types";

export function SettingsView() {
  const instanceSectionRef = useRef<SettingsInstanceSectionHandle>(null);
  const [channels, setChannels] = useState<NotificationChannelMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  // reactive re-render tick when child handle updates
  const [, setTick] = useState(0);

  const loadChannels = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setChannels(await listNotificationChannels());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadChannels();
  }, [loadChannels]);

  const onSectionError = useCallback((msg: string) => {
    setError(msg);
    setMessage("");
  }, []);
  const onSectionMessage = useCallback((msg: string) => {
    setMessage(msg);
    setError("");
    setTick((t) => t + 1);
  }, []);

  const instance = instanceSectionRef.current?.instance ?? null;
  const health = instanceSectionRef.current?.health ?? null;

  return (
    <div>
      <PageHeader title="Settings" subtitle="Instance configuration" />

      {error ? <div className="alert alert-error">{error}</div> : null}
      {message ? <div className="alert alert-info">{message}</div> : null}
      {loading ? (
        <div className="empty">Loading…</div>
      ) : (
        <>
          {instance ? (
            <StatGrid>
              <StatTile metricKey="settings.version" value={health?.version ?? "—"} />
              <StatTile
                metricKey="settings.scheduler"
                value={instance.paused ? "Paused" : "Active"}
              />
              <StatTile
                metricKey="settings.telemetry"
                value={instance.telemetryEnabled ? "On" : "Off"}
              />
            </StatGrid>
          ) : null}

          <SettingsInstanceSection
            ref={instanceSectionRef}
            onError={onSectionError}
            onMessage={onSectionMessage}
          />
          <SettingsSchedulingSection onError={onSectionError} onMessage={onSectionMessage} />
          <SettingsDoctorSection onError={onSectionError} />
          <SettingsTokensSection onError={onSectionError} onMessage={onSectionMessage} />
          <NotificationChannelsPanel
            initialChannels={channels}
            onError={onSectionError}
            onMessage={onSectionMessage}
          />
          <SettingsBackupsSection onError={onSectionError} onMessage={onSectionMessage} />
        </>
      )}
    </div>
  );
}
