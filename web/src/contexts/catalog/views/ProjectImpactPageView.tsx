import { ProjectImpactSection } from "@/contexts/catalog/components/ProjectImpactSection";
import { useProjectShell } from "@/contexts/catalog/project-shell";

export function ProjectImpactPageView() {
  const { projectId, openPrTotal } = useProjectShell();
  return <ProjectImpactSection mode="full" projectId={projectId} openPrTotal={openPrTotal} />;
}
