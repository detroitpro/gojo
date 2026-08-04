import type { CookieSecureMode } from "@/platform/config/instance";

/** A subset of instance settings that the update use case touches. */
export interface InstanceView {
  bindHost: string;
  bindPort: number;
  publicBaseUrl: string | null;
  trustedProxies: string[];
  allowedOrigins: string[];
  ipAllowlist: string[];
  cookieSecure: CookieSecureMode;
  paused: boolean;
  telemetryEnabled: boolean;
  apiBaseUrl: string | null;
}

export interface InstancePatch {
  bindHost?: string;
  bindPort?: number;
  publicBaseUrl?: string | null;
  trustedProxies?: string[];
  allowedOrigins?: string[];
  ipAllowlist?: string[];
  cookieSecure?: CookieSecureMode;
  telemetryEnabled?: boolean;
}

/**
 * Persistence + side-effects for instance settings. Concrete implementation
 * lives on the AppContext (`ctx.instance` + `ctx.saveInstanceConfig()` +
 * telemetry toggle) — see infrastructure/app-context-instance-store.ts.
 */
export interface InstanceConfigStore {
  view(): InstanceView;
  applyPatch(patch: InstancePatch): { view: InstanceView; restartRequired: boolean };
  pause(): void;
  resume(): void;
}
