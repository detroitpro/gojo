import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from "react";
import { AppTextfield as Textfield } from "@/ui/AppTextfield";
import { AppSelect as Select } from "@/ui/AppSelect";
import { Network, Pause, Play, Power, Save } from "lucide-react";
import type { CookieSecureMode } from "@gojo/contracts/types";

import {
  getHealth,
  getInstance,
  pauseInstance,
  resumeInstance,
  updateInstance,
} from "@/contexts/operations/contract";
import { AppButton } from "@/ui/AppButton";
import type { HealthInfo, InstanceInfo } from "@/contexts/operations/types";

export type SettingsInstanceSectionProps = {
  onError: (msg: string) => void;
  onMessage: (msg: string) => void;
};

export type SettingsInstanceSectionHandle = {
  instance: InstanceInfo | null;
  health: HealthInfo | null;
  load: () => Promise<void>;
};

type NetworkForm = {
  bindHost: string;
  bindPort: number;
  publicBaseUrl: string;
  trustedProxies: string;
  allowedOrigins: string;
  ipAllowlist: string;
  cookieSecure: CookieSecureMode;
};

const COOKIE_OPTIONS: Array<{ value: CookieSecureMode; label: string }> = [
  { value: "auto", label: "auto" },
  { value: "always", label: "always" },
  { value: "never", label: "never" },
];

function splitCsv(raw: string): string[] {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export const SettingsInstanceSection = forwardRef<
  SettingsInstanceSectionHandle,
  SettingsInstanceSectionProps
>(function SettingsInstanceSection({ onError, onMessage }, ref) {
  const [instance, setInstance] = useState<InstanceInfo | null>(null);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [networkRestartHint, setNetworkRestartHint] = useState(false);
  const [form, setForm] = useState<NetworkForm>({
    bindHost: "127.0.0.1",
    bindPort: 7430,
    publicBaseUrl: "",
    trustedProxies: "",
    allowedOrigins: "",
    ipAllowlist: "",
    cookieSecure: "auto",
  });

  const sync = useCallback((info: InstanceInfo) => {
    setForm({
      bindHost: info.bindHost,
      bindPort: info.bindPort,
      publicBaseUrl: info.publicBaseUrl ?? "",
      trustedProxies: (info.trustedProxies ?? []).join(", "),
      allowedOrigins: (info.allowedOrigins ?? []).join(", "),
      ipAllowlist: (info.ipAllowlist ?? []).join(", "),
      cookieSecure: info.cookieSecure ?? "auto",
    });
  }, []);

  const load = useCallback(async () => {
    const [inst, h] = await Promise.all([getInstance(), getHealth()]);
    setInstance(inst);
    setHealth(h);
    sync(inst);
    setNetworkRestartHint(false);
  }, [sync]);

  useImperativeHandle(ref, () => ({ instance, health, load }), [instance, health, load]);

  useEffect(() => {
    void load();
  }, [load]);

  function applyCloudflarePreset() {
    setForm((prev) => {
      const current = splitCsv(prev.trustedProxies);
      if (!current.some((e) => e.toLowerCase() === "cloudflare")) current.push("cloudflare");
      if (!current.includes("127.0.0.1")) current.push("127.0.0.1");
      let publicBaseUrl = prev.publicBaseUrl;
      if (!publicBaseUrl.trim() && typeof window !== "undefined") {
        const { protocol, host } = window.location;
        if (host !== "127.0.0.1" && host !== "localhost" && !host.startsWith("[")) {
          publicBaseUrl = `${protocol}//${host}`;
        }
      }
      return { ...prev, trustedProxies: current.join(", "), publicBaseUrl };
    });
  }

  async function togglePause() {
    if (!instance) return;
    setBusy(true);
    try {
      if (instance.paused) await resumeInstance();
      else await pauseInstance();
      const [inst, h] = await Promise.all([getInstance(), getHealth()]);
      setInstance(inst);
      setHealth(h);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to update pause state");
    } finally {
      setBusy(false);
    }
  }

  async function toggleTelemetry() {
    if (!instance) return;
    setBusy(true);
    try {
      const next = await updateInstance({ telemetryEnabled: !instance.telemetryEnabled });
      setInstance(next);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to update telemetry");
    } finally {
      setBusy(false);
    }
  }

  async function saveNetwork() {
    setBusy(true);
    try {
      const publicRaw = form.publicBaseUrl.trim();
      const next = await updateInstance({
        bindHost: form.bindHost.trim(),
        bindPort: Number(form.bindPort),
        publicBaseUrl: publicRaw.length > 0 ? publicRaw : null,
        trustedProxies: splitCsv(form.trustedProxies),
        allowedOrigins: splitCsv(form.allowedOrigins),
        ipAllowlist: splitCsv(form.ipAllowlist),
        cookieSecure: form.cookieSecure,
      });
      setInstance(next);
      sync(next);
      const restart = Boolean(next.restartRequired);
      setNetworkRestartHint(restart);
      onMessage(
        restart
          ? "Network settings saved — restart the daemon for bind/proxy changes to take effect"
          : "Network settings saved",
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to save network settings");
    } finally {
      setBusy(false);
    }
  }

  if (!instance) return null;

  return (
    <>
      <section className="panel">
        <div className="panel-header">Instance</div>
        <div className="panel-body">
          <p className="mono">
            {instance.bindHost}:{instance.bindPort}
          </p>
          {instance.publicBaseUrl ? (
            <p className="mono muted mt-2">public {instance.publicBaseUrl}</p>
          ) : null}
          {instance.apiBaseUrl ? (
            <p className="mono muted mt-2">agents {instance.apiBaseUrl}</p>
          ) : null}
          <div className="toolbar mt-5">
            <AppButton
              size="sm"
              loading={busy}
              loadingLabel="Working…"
              onClick={() => void togglePause()}
              iconBefore={instance.paused ? <Play size={12} /> : <Pause size={12} />}
            >
              {instance.paused ? "Resume scheduler" : "Pause scheduler"}
            </AppButton>
            <AppButton
              size="sm"
              loading={busy}
              loadingLabel="Working…"
              onClick={() => void toggleTelemetry()}
              iconBefore={<Power size={12} />}
            >
              {instance.telemetryEnabled ? "Disable telemetry" : "Enable telemetry"}
            </AppButton>
          </div>
          <div className="mono muted mt-5">
            health status={health?.status ?? "unknown"} paused={String(health?.paused)}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">Network</div>
        <div className="panel-body">
          <p className="muted mb-5">
            Cloudflare (or any reverse proxy) terminates TLS. Gojo speaks HTTP on the bind address.
            Set <span className="mono">publicBaseUrl</span> to the URL browsers and agents use, and{" "}
            <span className="mono">trustedProxies</span> so{" "}
            <span className="mono">X-Forwarded-*</span> is honored.
          </p>
          <div className="inline-form network-form">
            <div className="field">
              <label htmlFor="net-bind-host">Bind host</label>
              <Textfield
                id="net-bind-host"
                value={form.bindHost}
                onChange={(e) => setForm((p) => ({ ...p, bindHost: e.currentTarget.value }))}
              />
            </div>
            <div className="field">
              <label htmlFor="net-bind-port">Bind port</label>
              <Textfield
                id="net-bind-port"
                type="number"
                value={String(form.bindPort)}
                onChange={(e) =>
                  setForm((p) => ({ ...p, bindPort: Number(e.currentTarget.value) || 0 }))
                }
              />
            </div>
            <div className="field field-wide">
              <label htmlFor="net-public-url">Public base URL</label>
              <Textfield
                id="net-public-url"
                value={form.publicBaseUrl}
                onChange={(e) => setForm((p) => ({ ...p, publicBaseUrl: e.currentTarget.value }))}
                placeholder="https://gojo.example.com"
              />
            </div>
            <div className="field field-wide">
              <label htmlFor="net-proxies">Trusted proxies</label>
              <Textfield
                id="net-proxies"
                value={form.trustedProxies}
                onChange={(e) =>
                  setForm((p) => ({ ...p, trustedProxies: e.currentTarget.value }))
                }
                placeholder="cloudflare, 127.0.0.1"
              />
            </div>
            <div className="field field-wide">
              <label htmlFor="net-origins">Allowed origins</label>
              <Textfield
                id="net-origins"
                value={form.allowedOrigins}
                onChange={(e) =>
                  setForm((p) => ({ ...p, allowedOrigins: e.currentTarget.value }))
                }
                placeholder="(defaults to publicBaseUrl origin)"
              />
            </div>
            <div className="field field-wide">
              <label htmlFor="net-allowlist">IP allowlist</label>
              <Textfield
                id="net-allowlist"
                value={form.ipAllowlist}
                onChange={(e) => setForm((p) => ({ ...p, ipAllowlist: e.currentTarget.value }))}
                placeholder="(empty = any)"
              />
            </div>
            <div className="field">
              <label htmlFor="net-cookie">Cookie Secure</label>
              <Select
                inputId="net-cookie"
                value={COOKIE_OPTIONS.find((o) => o.value === form.cookieSecure)}
                options={COOKIE_OPTIONS}
                onChange={(opt) =>
                  opt && setForm((p) => ({ ...p, cookieSecure: opt.value as CookieSecureMode }))
                }
                isSearchable={false}
              />
            </div>
          </div>
          <div className="toolbar mt-5">
            <AppButton
              size="sm"
              variant="primary"
              loading={busy}
              loadingLabel="Saving…"
              onClick={() => void saveNetwork()}
              iconBefore={<Save size={12} />}
            >
              Save network
            </AppButton>
            <AppButton
              size="sm"
              disabled={busy}
              onClick={applyCloudflarePreset}
              iconBefore={<Network size={12} />}
            >
              Cloudflare preset
            </AppButton>
          </div>
          {networkRestartHint ? (
            <p className="alert alert-info mt-5">
              Restart required: <span className="mono">gojo service restart</span>
            </p>
          ) : null}
          <p className="muted mt-4">
            Tunnel tip: if cloudflared connects on localhost, include{" "}
            <span className="mono">127.0.0.1</span> in trusted proxies. Classic orange-cloud proxy
            needs the <span className="mono">cloudflare</span> token (published CF CIDRs).
          </p>
        </div>
      </section>
    </>
  );
});
