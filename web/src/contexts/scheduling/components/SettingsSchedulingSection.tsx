import { useCallback, useEffect, useState } from "react";
import { AppTextfield as Textfield } from "@/ui/AppTextfield";
import { Save } from "lucide-react";

import {
  getSchedulingPolicy,
  updateSchedulingPolicy,
} from "@/contexts/scheduling/contract";
import { AppButton } from "@/ui/AppButton";
import type { SchedulingPolicy } from "@/contexts/scheduling/types";

const DEFAULT: SchedulingPolicy = {
  maxConcurrentRuns: 2,
  maxConcurrentRunsPerProject: 1,
  minStartIntervalMs: 30_000,
  maxLoadPerCpu: 1,
};

export function SettingsSchedulingSection({
  onError,
  onMessage,
}: {
  onError: (msg: string) => void;
  onMessage: (msg: string) => void;
}) {
  const [scheduling, setScheduling] = useState<SchedulingPolicy>(DEFAULT);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setScheduling(await getSchedulingPolicy());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setBusy(true);
    try {
      const next = await updateSchedulingPolicy({
        maxConcurrentRuns: Number(scheduling.maxConcurrentRuns),
        maxConcurrentRunsPerProject: Number(scheduling.maxConcurrentRunsPerProject),
        minStartIntervalMs: Number(scheduling.minStartIntervalMs),
        maxLoadPerCpu: Number(scheduling.maxLoadPerCpu),
      });
      setScheduling(next);
      onMessage("Scheduling policy saved");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to save scheduling policy");
    } finally {
      setBusy(false);
    }
  }

  function numField(id: string, label: string, key: keyof SchedulingPolicy, step?: number) {
    return (
      <div className="field">
        <label htmlFor={id}>{label}</label>
        <Textfield
          id={id}
          type="number"
          step={step}
          value={String(scheduling[key])}
          onChange={(e) =>
            setScheduling((prev) => ({ ...prev, [key]: Number(e.currentTarget.value) || 0 }))
          }
        />
      </div>
    );
  }

  return (
    <section className="panel">
      <div className="panel-header">Run admission</div>
      <div className="panel-body">
        <p className="muted mb-5">
          Cron times are suggestions. The dispatcher admits runs under these caps so projects do
          not stampede the host.
        </p>
        <div className="inline-form">
          {numField("sched-max", "Max concurrent runs", "maxConcurrentRuns")}
          {numField("sched-per-project", "Max per project", "maxConcurrentRunsPerProject")}
          {numField("sched-stagger", "Stagger (ms)", "minStartIntervalMs", 1000)}
          {numField("sched-load", "Max load / CPU (0=off)", "maxLoadPerCpu", 0.1)}
        </div>
        <div className="toolbar mt-5">
          <AppButton
            variant="primary"
            size="sm"
            loading={busy}
            loadingLabel="Saving…"
            onClick={() => void save()}
            iconBefore={<Save size={12} />}
          >
            Save admission policy
          </AppButton>
        </div>
      </div>
    </section>
  );
}
