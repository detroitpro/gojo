import { createContext, useContext } from "react";

import type { Agent, Project, ProjectSyncResult } from "@/contexts/catalog/types";
import type { ProjectDoctorResult } from "@/contexts/operations/contract";

export type ProjectShellContextValue = {
  projectId: string;
  project: Project | null;
  doctor: ProjectDoctorResult | null;
  projectAgents: Agent[];
  lastSync: ProjectSyncResult | null;
  openPrTotal: number;
  /** Bumped after load/sync so children can refresh dependent panels. */
  dataVersion: number;
  setOpenPrTotal: (value: number) => void;
  setError: (message: string) => void;
  setNotice: (message: string) => void;
};

export const ProjectShellContext = createContext<ProjectShellContextValue | null>(null);

export function useProjectShell(): ProjectShellContextValue {
  const ctx = useContext(ProjectShellContext);
  if (!ctx) {
    throw new Error("useProjectShell must be used inside <ProjectShellView>");
  }
  return ctx;
}
