import { useMemo } from "react";
import { Link } from "react-router-dom";

import type { Project } from "@/contexts/catalog/types";
import type { ProjectDoctorResult } from "@/contexts/operations/contract";
import {
  computeProjectHealth,
  projectHealthFactors,
} from "@/kernel/project-manifest";
import { HealthBadge } from "@/ui/status/HealthBadge";

export function ProjectHealthPanel({
  project,
  doctor,
}: {
  project: Project;
  doctor: ProjectDoctorResult | null;
}) {
  const health = useMemo(() => computeProjectHealth(project, doctor), [project, doctor]);
  const workspaceFiles = doctor?.workspaceFiles ?? null;
  const factors = useMemo(
    () => projectHealthFactors(project, doctor, { workspaceFiles }),
    [project, doctor, workspaceFiles],
  );
  const scored = factors.filter((f) => f.scored);
  const info = factors.filter((f) => !f.scored);

  return (
    <section className="panel mb-7">
      <div className="panel-header">
        Health
        <HealthBadge level={health.level} label={health.label} />
      </div>
      <div className="panel-body">
        <p className="muted">
          Score is 0–100 from project doctor checks on the registered base checkout (not a
          percentage). Fix failing scored factors below, then refresh this page.
        </p>
        {!doctor ? (
          <div className="muted mt-5">Doctor results unavailable.</div>
        ) : (
          <>
            <div className="mt-5">
              <div className="panel-subheader">Score factors</div>
              <ul className="health-checklist">
                {scored.map((factor) => (
                  <li key={factor.id}>
                    <span className={factor.ok ? "ok" : "bad"}>●</span> {factor.label}
                    {!factor.ok && factor.penalty > 0 ? (
                      <span className="muted"> · −{factor.penalty}</span>
                    ) : null}
                    {factor.remediation ? (
                      <p className="muted text-sm mt-2">{factor.remediation}</p>
                    ) : null}
                    {factor.details?.length ? (
                      <ul className="muted mt-2 health-dirty-files">
                        {factor.details.slice(0, 12).map((detail) => (
                          <li key={detail} className="mono">
                            {detail}
                          </li>
                        ))}
                        {factor.details.length > 12 ? (
                          <li>… +{factor.details.length - 12} more</li>
                        ) : null}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>

            {info.length ? (
              <div className="mt-7">
                <div className="panel-subheader">Also checked (not in score)</div>
                <ul className="health-checklist">
                  {info.map((factor) => (
                    <li key={factor.id}>
                      <span className={factor.ok ? "ok" : "bad"}>●</span> {factor.label}
                      {factor.remediation ? (
                        <p className="muted text-sm mt-2">{factor.remediation}</p>
                      ) : null}
                      {factor.details?.length ? (
                        <ul className="muted mt-2 health-dirty-files">
                          {factor.details.map((detail) => (
                            <li key={detail} className="mono">
                              {detail}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {factor.id === "workspace-generated" &&
                      workspaceFiles?.suggestedGitignore ? (
                        <pre className="mono mt-2 gitignore-suggestion">
                          {workspaceFiles.suggestedGitignore}
                        </pre>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <p className="muted text-sm mt-5">
              CLI: <span className="mono">gojo project doctor {project.id}</span> ·{" "}
              <Link to={`/projects/${project.id}/configuration`} className="entity-name">
                Configuration
              </Link>{" "}
              for sync and manifest.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
