import { ProjectHealthPanel } from "@/contexts/catalog/components/ProjectHealthPanel";
import { useProjectShell } from "@/contexts/catalog/project-shell";

export function ProjectHealthView() {
  const { project, doctor } = useProjectShell();
  if (!project) return null;
  return <ProjectHealthPanel project={project} doctor={doctor} />;
}
