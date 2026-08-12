import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Calendar, Play, Power } from "lucide-react";

import {
  disableAgent,
  enableAgent,
  getAgent,
  listSchedules,
  runAgent,
  useCatalogStore,
} from "@/contexts/catalog/contract";
import { AppButton } from "@/ui/AppButton";
import { PageHeader } from "@/ui/PageHeader";
import { EnabledBadge } from "@/ui/status/EnabledBadge";
import { RunHistoryStrip } from "@/ui/RunHistoryStrip";
import { useBindStoreRefresh } from "@/platform/bind-store-refresh";
import { useSoftLoading } from "@/platform/useSoftLoading";
import { formatRunSuccessRate } from "@/kernel/run-success-rate";
import type { Agent, Schedule } from "@/contexts/catalog/types";

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw || "—";
  }
}

export function AgentDetailView() {
  const { id: agentId = "" } = useParams();
  const navigate = useNavigate();

  const [agent, setAgent] = useState<Agent | null>(null);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const soft = useSoftLoading(Boolean(agent));

  const load = useCallback(async () => {
    setError("");
    try {
      await soft.run(async () => {
        const a = await getAgent(agentId);
        setAgent(a);
        const sched = await listSchedules({
          agentId,
          enabled: "all",
          limit: 100,
          offset: 0,
        });
        setSchedules(sched.items);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agent");
    }
  }, [agentId, soft.run]);

  useEffect(() => {
    setAgent(null);
    setSchedules([]);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  useBindStoreRefresh(useCatalogStore.getState(), load);

  async function runNow() {
    if (!agent) return;
    setBusy(true);
    setError("");
    try {
      const run = await runAgent(agent.id);
      navigate(`/runs/${run.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start run");
    } finally {
      setBusy(false);
    }
  }

  async function toggleEnabled() {
    if (!agent) return;
    setBusy(true);
    setError("");
    try {
      if (agent.enabled) await disableAgent(agent.id);
      else await enableAgent(agent.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update agent");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title={agent?.name ?? "Agent"}
        subtitle={agent?.description ?? undefined}
        actions={
          agent ? (
            <>
              <AppButton
                variant="primary"
                loading={busy}
                loadingLabel="Starting…"
                disabled={!agent.enabled}
                title={!agent.enabled ? "Agent is disabled" : undefined}
                onClick={() => void runNow()}
                iconBefore={<Play size={16} />}
              >
                Run now
              </AppButton>{" "}
              <AppButton
                loading={busy}
                loadingLabel="Working…"
                onClick={() => void toggleEnabled()}
                iconBefore={<Power size={16} />}
              >
                {agent.enabled ? "Disable" : "Enable"}
              </AppButton>
            </>
          ) : null
        }
      />

      {error ? <div className="alert alert-error">{error}</div> : null}

      {soft.loading && !agent ? (
        <div className="empty">Loading…</div>
      ) : agent ? (
        <>
          <section className="panel panel-callout mb-7">
            <div className="panel-header">How to edit</div>
            <div className="panel-body">
              <p className="mb-3">
                Agent config is owned by the project manifest — edit YAML (or ask an agent), then
                Sync. Enable/Disable here is a runtime ops toggle; the next Sync reapplies{" "}
                <span className="mono">agents.&lt;name&gt;.enabled</span> from YAML if set.
              </p>
              <dl className="project-meta">
                <div>
                  <dt>Repository</dt>
                  <dd className="mono">{agent.source?.repoPath || "—"}</dd>
                </div>
                <div>
                  <dt>Manifest</dt>
                  <dd className="mono">
                    {agent.source?.manifestPath || "Not in synced manifest"}
                  </dd>
                </div>
                <div>
                  <dt>Prompt file</dt>
                  <dd className="mono">
                    {agent.source?.promptAbsolutePath ||
                      agent.source?.promptFile ||
                      "Not in synced manifest"}
                  </dd>
                </div>
              </dl>
              <ol className="task-edit-steps muted mt-5">
                <li>
                  Edit the agent entry in <span className="mono">gojo.yaml</span> and its{" "}
                  <span className="mono">promptFile</span> in the repo (or have an agent do it).
                </li>
                <li>
                  Open the <Link to={`/projects/${agent.projectId}`}>project</Link> and run{" "}
                  <strong>Sync</strong> so gojo reloads config into the database.
                </li>
                <li>
                  Enable/Disable here is ops-only; sync may still soft-disable agents missing from{" "}
                  <span className="mono">gojo.yaml</span>.
                </li>
              </ol>
            </div>
          </section>

          <section className="panel mb-7">
            <div className="panel-header">
              Overview
              <EnabledBadge enabled={agent.enabled} />
            </div>
            <div className="panel-body">
              <dl className="project-meta">
                <div>
                  <dt>Project</dt>
                  <dd>
                    <Link to={`/projects/${agent.projectId}`}>
                      {agent.projectName || agent.projectId}
                    </Link>
                  </dd>
                </div>
                <div>
                  <dt>Profile</dt>
                  <dd>{agent.profileName || "—"}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd className="mono">{new Date(agent.createdAt).toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Recent success</dt>
                  <dd className="mono">{formatRunSuccessRate(agent.recentRuns ?? [])}</dd>
                </div>
              </dl>
              <div className="mt-5">
                <RunHistoryStrip runs={agent.recentRuns ?? []} />
              </div>
              <div className="toolbar mt-5">
                <AppButton
                  to={`/runs?agentId=${encodeURIComponent(agent.id)}&projectId=${encodeURIComponent(agent.projectId)}`}
                  iconBefore={<Play size={16} />}
                >
                  View all runs
                </AppButton>{" "}
                <AppButton
                  to={`/schedules?agentId=${encodeURIComponent(agent.id)}&projectId=${encodeURIComponent(agent.projectId)}&enabled=all`}
                  iconBefore={<Calendar size={16} />}
                >
                  View schedules
                </AppButton>
              </div>
            </div>
          </section>

          <section className="panel mb-7">
            <div className="panel-header">Prompt</div>
            <div className="panel-body">
              <p className="muted text-sm mb-3">
                Last-synced snapshot
                {agent.source?.promptFile ? (
                  <>
                    {" "}
                    from <span className="mono">{agent.source.promptFile}</span>
                  </>
                ) : null}
                . Edit the file in the repo, then Sync.
              </p>
              <pre className="task-prompt-body">{agent.prompt || "—"}</pre>
            </div>
          </section>

          <section className="panel mb-7">
            <div className="panel-header">Policy</div>
            <div className="panel-body policy-grid">
              <div>
                <div className="panel-subheader">Validation</div>
                <pre className="task-policy-body">
                  {prettyJson(agent.validationProfileJson)}
                </pre>
              </div>
              <div>
                <div className="panel-subheader">Integration</div>
                <pre className="task-policy-body">{prettyJson(agent.integrationJson)}</pre>
              </div>
              <div>
                <div className="panel-subheader">Failure</div>
                <pre className="task-policy-body">{prettyJson(agent.failurePolicyJson)}</pre>
              </div>
              <div>
                <div className="panel-subheader">Concurrency</div>
                <pre className="task-policy-body">{prettyJson(agent.concurrencyJson)}</pre>
              </div>
              <div>
                <div className="panel-subheader">Environment</div>
                <pre className="task-policy-body">{prettyJson(agent.environmentJson)}</pre>
              </div>
            </div>
          </section>

          <section className="list-section">
            <div className="list-section__header">
              <h2 className="list-section__title">Schedules</h2>
              <span className="list-section__meta">{schedules.length}</span>
            </div>
            {schedules.length === 0 ? (
              <div className="muted">No schedules for this agent</div>
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Cron</th>
                      <th>Status</th>
                      <th>Next</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schedules.map((schedule) => (
                      <tr key={schedule.id}>
                        <td>{schedule.name}</td>
                        <td>
                          <div>{schedule.cronDescription || schedule.cronExpr}</div>
                          <div className="mono muted text-sm">{schedule.cronExpr}</div>
                        </td>
                        <td>
                          <EnabledBadge enabled={schedule.enabled} />
                        </td>
                        <td className="mono muted">
                          {schedule.nextRunAt
                            ? new Date(schedule.nextRunAt).toLocaleString()
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
