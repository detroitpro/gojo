/** Reserved prefix for platform-minted run branches. */
export const RUN_BRANCH_NAMESPACE = 'gojo/run';

function sanitizeSegment(value: string, fallback: string): string {
  return (
    value
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 64) || fallback
  );
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Canonical run branch name:
 * `gojo/run/<agent>/<project>/<YYYY-MM-DD>/run-<runId>[-aN]`
 */
export function buildRunBranchName(
  agentName: string,
  runId: string,
  projectName: string,
  date = new Date(),
  attemptNumber = 1,
): string {
  const safeProject = sanitizeSegment(projectName, 'project');
  const safeAgent = sanitizeSegment(agentName, 'agent');
  const attemptSuffix = attemptNumber > 1 ? `-a${attemptNumber}` : '';
  return `${RUN_BRANCH_NAMESPACE}/${safeAgent}/${safeProject}/${formatDate(date)}/run-${runId}${attemptSuffix}`;
}
