import type { AppContext } from "@/platform/app-context";
import { normalizePublicBaseUrl, resolveApiBaseUrl } from "@/platform/config/instance";

import type {
  InstanceConfigStore,
  InstancePatch,
  InstanceView,
} from "../ports/instance-config-store";

function apiBaseUrlFor(ctx: AppContext): string | null {
  try {
    return resolveApiBaseUrl(ctx.instance);
  } catch {
    return null;
  }
}

function parseStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error("value must be an array of strings");
  }
  if (!value.every((item) => typeof item === "string")) {
    throw new Error("value must be an array of strings");
  }
  return value.map((item) => item.trim()).filter((item) => item.length > 0);
}

/**
 * @removal(when: operations owns instance-config state directly): drop the
 * AppContext-shaped adapter once instance state moves under the context —
 * removal-backlog OP1
 */
export class AppContextInstanceStore implements InstanceConfigStore {
  constructor(private readonly ctx: AppContext) {}

  view(): InstanceView {
    const ctx = this.ctx;
    return {
      bindHost: ctx.instance.bindHost,
      bindPort: ctx.instance.bindPort,
      publicBaseUrl: ctx.instance.publicBaseUrl,
      trustedProxies: ctx.instance.trustedProxies,
      allowedOrigins: ctx.instance.allowedOrigins,
      ipAllowlist: ctx.instance.ipAllowlist,
      cookieSecure: ctx.instance.cookieSecure,
      paused: ctx.isPaused(),
      telemetryEnabled: ctx.instance.telemetryEnabled,
      apiBaseUrl: apiBaseUrlFor(ctx),
    };
  }

  applyPatch(patch: InstancePatch): { view: InstanceView; restartRequired: boolean } {
    const ctx = this.ctx;
    let restartRequired = false;

    if (patch.telemetryEnabled !== undefined) {
      if (typeof patch.telemetryEnabled !== "boolean") {
        throw new Error("telemetryEnabled must be a boolean");
      }
      ctx.setTelemetryEnabled(patch.telemetryEnabled);
    }
    if (patch.bindHost !== undefined) {
      if (typeof patch.bindHost !== "string" || !patch.bindHost.trim()) {
        throw new Error("bindHost must be a non-empty string");
      }
      ctx.instance.bindHost = patch.bindHost.trim();
      restartRequired = true;
    }
    if (patch.bindPort !== undefined) {
      if (typeof patch.bindPort !== "number" || !Number.isInteger(patch.bindPort)) {
        throw new Error("bindPort must be an integer");
      }
      if (patch.bindPort < 1 || patch.bindPort > 65535) {
        throw new Error("bindPort must be between 1 and 65535");
      }
      ctx.instance.bindPort = patch.bindPort;
      restartRequired = true;
    }
    if (patch.publicBaseUrl !== undefined) {
      ctx.instance.publicBaseUrl =
        patch.publicBaseUrl === null
          ? null
          : normalizePublicBaseUrl(patch.publicBaseUrl);
      restartRequired = true;
    }
    if (patch.trustedProxies !== undefined) {
      ctx.instance.trustedProxies = parseStringList(patch.trustedProxies);
      restartRequired = true;
    }
    if (patch.allowedOrigins !== undefined) {
      ctx.instance.allowedOrigins = parseStringList(patch.allowedOrigins);
      restartRequired = true;
    }
    if (patch.ipAllowlist !== undefined) {
      ctx.instance.ipAllowlist = parseStringList(patch.ipAllowlist);
      restartRequired = true;
    }
    if (patch.cookieSecure !== undefined) {
      if (
        patch.cookieSecure !== "auto" &&
        patch.cookieSecure !== "always" &&
        patch.cookieSecure !== "never"
      ) {
        throw new Error("cookieSecure must be auto, always, or never");
      }
      ctx.instance.cookieSecure = patch.cookieSecure;
      restartRequired = true;
    }

    if (restartRequired) {
      ctx.saveInstanceConfig();
    }

    return { view: this.view(), restartRequired };
  }

  pause(): void {
    this.ctx.setPaused(true);
  }

  resume(): void {
    this.ctx.setPaused(false);
  }
}
