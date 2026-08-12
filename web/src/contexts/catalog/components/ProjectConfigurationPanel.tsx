import { useMemo } from "react";
import { Link } from "react-router-dom";

import type { Agent, Project, ProjectSyncResult } from "@/contexts/catalog/types";
import { parseManifestView } from "@/kernel/project-manifest";

export function ProjectConfigurationPanel({
  project,
  agents,
  lastSync,
}: {
  project: Project;
  agents: Agent[];
  lastSync: ProjectSyncResult | null;
}) {
  const manifest = useMemo(() => parseManifestView(project.manifestJson), [project.manifestJson]);
  const agentsByName = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const agent of agents) map.set(agent.name, agent);
    return map;
  }, [agents]);

  return (
    <>
      <section className="panel mb-7">
        <div className="panel-header">Sync</div>
        <div className="panel-body">
          <p className="muted">
            Sync reads <span className="mono">gojo.yaml</span> (or{" "}
            <span className="mono">.gojo/project.yaml</span>) and upserts profiles, agents, and
            schedules by name. Entries removed from the manifest are soft-disabled so they stop
            firing. Sync does not change git history or your working tree. Use{" "}
            <strong>Sync</strong> in the page header to run it.
          </p>
          {lastSync ? (
            <div className="mt-5 project-sync-result">
              <div>
                Manifest: <span className="mono">{lastSync.manifestPath ?? "not found"}</span>
              </div>
              <div className="muted mt-2">
                {lastSync.profiles} profiles · {lastSync.agents} agents · {lastSync.schedules}{" "}
                schedules
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section className="panel mb-7">
        <div className="panel-header">Configuration</div>
        <div className="panel-body">
          {!project.hasManifest ? (
            <div className="muted">
              No synced manifest yet. Run Sync after adding a{" "}
              <span className="mono">gojo.yaml</span>.
            </div>
          ) : !manifest.ok ? (
            <div className="alert alert-error">Could not parse manifest: {manifest.error}</div>
          ) : (
            <>
              {Object.keys(manifest.repository).length ? (
                <div className="mb-7">
                  <div className="panel-subheader">Repository</div>
                  <ul className="project-kv">
                    {Object.entries(manifest.repository).map(([key, value]) => (
                      <li key={key}>
                        <span className="mono">{key}</span>
                        <span className="muted">{String(value)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="mb-7">
                <div className="panel-subheader">Profiles ({manifest.profiles.length})</div>
                {manifest.profiles.length === 0 ? (
                  <div className="muted">None</div>
                ) : (
                  <div className="table-wrap">
                    <table className="data">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Adapter</th>
                          <th>Model</th>
                          <th>Timeout</th>
                        </tr>
                      </thead>
                      <tbody>
                        {manifest.profiles.map((profile) => (
                          <tr key={profile.name}>
                            <td className="entity-name">{profile.name}</td>
                            <td className="mono">{profile.adapter}</td>
                            <td className="mono muted">{profile.model ?? "—"}</td>
                            <td className="mono muted">{profile.timeout ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="mb-7">
                <div className="panel-subheader">Agents ({manifest.agents.length})</div>
                {manifest.agents.length === 0 ? (
                  <div className="muted">None</div>
                ) : (
                  <div className="table-wrap">
                    <table className="data">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Profile</th>
                          <th>Integration</th>
                          <th>Description</th>
                        </tr>
                      </thead>
                      <tbody>
                        {manifest.agents.map((agent) => {
                          const linked = agentsByName.get(agent.name);
                          return (
                            <tr key={agent.name}>
                              <td>
                                {linked ? (
                                  <Link to={`/agents/${linked.id}`} className="entity-name">
                                    {agent.name}
                                  </Link>
                                ) : (
                                  <span className="entity-name">{agent.name}</span>
                                )}
                              </td>
                              <td className="mono">{agent.profile}</td>
                              <td className="mono">{agent.integrationMode}</td>
                              <td className="muted">{agent.description || "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="mb-7">
                <div className="panel-subheader">Schedules ({manifest.schedules.length})</div>
                {manifest.schedules.length === 0 ? (
                  <div className="muted">None</div>
                ) : (
                  <div className="table-wrap">
                    <table className="data">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Agent</th>
                          <th>Cron</th>
                          <th>Timezone</th>
                        </tr>
                      </thead>
                      <tbody>
                        {manifest.schedules.map((schedule) => (
                          <tr key={schedule.name}>
                            <td className="entity-name">{schedule.name}</td>
                            <td className="mono">{schedule.agent}</td>
                            <td className="mono">{schedule.cron}</td>
                            <td className="mono muted">{schedule.timezone}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="mb-7">
                <div className="panel-subheader">
                  Validation profiles ({manifest.validationProfiles.length})
                </div>
                {manifest.validationProfiles.length === 0 ? (
                  <div className="muted">None</div>
                ) : (
                  <ul className="project-kv">
                    {manifest.validationProfiles.map((profile) => (
                      <li key={profile.name}>
                        <span className="mono">{profile.name}</span>
                        <span className="muted">{profile.stepCount} steps</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <details className="project-raw-json">
                <summary className="muted">Advanced: raw JSON</summary>
                <pre className="pre-block">{manifest.prettyJson}</pre>
              </details>
            </>
          )}
        </div>
      </section>
    </>
  );
}
