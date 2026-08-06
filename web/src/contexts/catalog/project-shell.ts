import type { InjectionKey, Ref } from "vue";

import type { Agent, Project, ProjectSyncResult } from "@/contexts/catalog/types";
import type { ProjectDoctorResult } from "@/contexts/operations/contract";

export type ProjectShellContext = {
  projectId: Ref<string>;
  project: Ref<Project | null>;
  doctor: Ref<ProjectDoctorResult | null>;
  projectAgents: Ref<Agent[]>;
  lastSync: Ref<ProjectSyncResult | null>;
  openPrTotal: Ref<number>;
  /** Bumped after load/sync so children can refresh dependent panels. */
  dataVersion: Ref<number>;
  setOpenPrTotal: (value: number) => void;
  setError: (message: string) => void;
  setNotice: (message: string) => void;
};

export const projectShellKey: InjectionKey<ProjectShellContext> = Symbol("projectShell");
