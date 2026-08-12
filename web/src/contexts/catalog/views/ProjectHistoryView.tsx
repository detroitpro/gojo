import { useProjectShell } from "@/contexts/catalog/project-shell";
import { ProjectHistoryPanel } from "@/contexts/work/components/ProjectHistoryPanel";

export function ProjectHistoryView() {
  const { projectId } = useProjectShell();
  return <ProjectHistoryPanel projectId={projectId} />;
}
