import { ProjectConfigurationPanel } from "@/contexts/catalog/components/ProjectConfigurationPanel";
import { useProjectShell } from "@/contexts/catalog/project-shell";

export function ProjectConfigurationView() {
  const { project, projectAgents, lastSync } = useProjectShell();
  if (!project) return null;
  return (
    <ProjectConfigurationPanel project={project} agents={projectAgents} lastSync={lastSync} />
  );
}
