import type { Run, RunArtifactsResult } from "@/contexts/execution/types";

export interface HandoffAssetView {
  role: string;
  label: string;
  path?: string;
  mediaType: string;
  content?: string;
}

export type RunArtifactsSectionProps = {
  run: Run | null;
  artifacts: RunArtifactsResult | null;
  handoffText: string | null;
  handoffAssets: HandoffAssetView[];
  artifactsHandoffText: string | null;
  artifactsValidationText: string | null;
};

export function RunArtifactsSection({
  run,
  artifacts,
  handoffText,
  handoffAssets,
  artifactsHandoffText,
  artifactsValidationText,
}: RunArtifactsSectionProps) {
  return (
    <>
      <section className="panel">
        <div className="panel-header">Artifacts</div>
        <div className="panel-body">
          {!artifacts ? (
            <div className="muted">Loading…</div>
          ) : (
            <>
              <div className="mono">
                path={artifacts.path}
                <br />
                exists={String(artifacts.exists)}
              </div>

              {handoffAssets.length ? (
                <div className="mt-4">
                  <div className="panel-subheader">Handoff assets</div>
                  <ul className="handoff-assets">
                    {handoffAssets.map((asset, idx) => (
                      <li key={`${asset.role}-${idx}`}>
                        <div className="handoff-asset-meta">
                          <span className="mono">{asset.role}</span>
                          <span className="muted">· {asset.label}</span>
                          {asset.path ? (
                            <span className="mono muted"> · {asset.path}</span>
                          ) : null}
                        </div>
                        {asset.content ? (
                          <pre className="pre-block mt-2 activity-assistant-body">
                            {asset.content}
                          </pre>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {artifactsHandoffText ? (
                <pre className="pre-block mt-4">{artifactsHandoffText}</pre>
              ) : (
                <div className="muted mt-4">No handoff.json on disk</div>
              )}
              {artifactsValidationText ? (
                <pre className="pre-block mt-4">{artifactsValidationText}</pre>
              ) : run?.errorMessage?.startsWith("Validation failed") ? (
                <div className="muted mt-4">No validation.json on disk</div>
              ) : null}
            </>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">Handoff JSON</div>
        <div className="panel-body">
          {handoffText ? (
            <pre className="pre-block">{handoffText}</pre>
          ) : (
            <div className="muted">No handoff payload yet</div>
          )}
        </div>
      </section>
    </>
  );
}
