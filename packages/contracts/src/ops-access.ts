/**
 * Ops, access, instance config, doctor, adapter, backup, and filesystem DTOs.
 */
import type { NotificationChannelConfig } from "./notifications";

export interface User {
  id: string;
  username: string;
  role: string;
}

export interface ApiTokenInfo {
  id: string;
  name: string;
  createdAt: string;
  expiresAt: string | null;
}

export interface CreatedApiToken extends ApiTokenInfo {
  token: string;
}

export type CookieSecureMode = "auto" | "always" | "never";

export interface InstanceInfo {
  bindHost: string;
  bindPort: number;
  paused: boolean;
  telemetryEnabled: boolean;
  publicBaseUrl: string | null;
  trustedProxies: string[];
  allowedOrigins: string[];
  ipAllowlist: string[];
  cookieSecure: CookieSecureMode;
  apiBaseUrl: string | null;
  restartRequired?: boolean;
}

export interface InstanceNetworkDoctor {
  bindHost: string;
  bindPort: number;
  loopback: boolean;
  publicBaseUrl: string | null;
  publicBaseUrlScheme: "http" | "https" | null;
  trustedProxiesConfigured: boolean;
  trustedProxyCidrCount: number;
  cookieSecure: CookieSecureMode;
  apiBaseUrl: string | null;
  ipAllowlistConfigured: boolean;
}

export interface HealthInfo {
  status: string;
  paused: boolean;
  version: string;
}

export interface ProjectBaseCheckout {
  clean: boolean;
  dirtyFiles: string[];
  behindOrigin: number | null;
}

export interface ProjectValidationToolCheck {
  agent: string;
  step: string;
  binary: string;
  found: boolean;
  path?: string;
  shellBuiltin?: boolean;
}

export interface ProjectWorkspaceFilesCheck {
  trackedGeneratedFiles: string[];
  unignoredGeneratedFiles: string[];
  untrackedRegistrationFiles: string[];
  suggestedGitignore: string | null;
}

export interface ProjectDoctorResult {
  projectId: string;
  repoExists: boolean;
  manifest: boolean;
  baseCheckout: ProjectBaseCheckout;
  validationTools: ProjectValidationToolCheck[];
  /** Absent when the daemon predates the workspace-files check. */
  workspaceFiles?: ProjectWorkspaceFilesCheck;
}

export interface DoctorToolCheck {
  name: string;
  found: boolean;
  path?: string;
}

/** Adapter detection result from GET /adapters. */
export interface AdapterInfo {
  name: string;
  installed: boolean;
  version?: string;
  authenticated?: boolean;
}

export interface InstanceDoctorResult {
  git: boolean;
  disk: boolean;
  database: boolean;
  /** Adapter detection info; backend field name is still `agents`. */
  agents: AdapterInfo[];
  home: string;
  daemonPath: string;
  tools: DoctorToolCheck[];
  binaryStale: boolean;
  binaryStatus: {
    stale: boolean;
    detail: string | null;
    exePath: string | null;
  };
  warnings: string[];
  /** Absent when the daemon predates network doctor checks. */
  network?: InstanceNetworkDoctor;
}

export interface AdapterTestResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  canceled: boolean;
  version?: string;
}

export interface ProjectSyncResult {
  manifestPath: string | null;
  profiles: number;
  agents: number;
  schedules: number;
}

export interface RunDiffResult {
  files: string[];
}

export interface RunArtifactsResult {
  path: string;
  exists: boolean;
  handoff: unknown | null;
  validation: unknown | null;
  failure: unknown | null;
}

export interface BackupInfo {
  path: string;
  name: string;
  size: number;
  createdAt: string;
}

export interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isGitRepo: boolean;
}

export interface DirectoryListing {
  path: string;
  parent: string | null;
  entries: DirectoryEntry[];
  isGitRepo: boolean;
}

export interface BrowseRoot {
  label: string;
  path: string;
}

export type NotificationChannelEntry = NotificationChannelConfig & {
  name: string;
};
