import { err, ok, type Result } from "@/kernel";

import type { DiagnosticsPort } from "../ports/diagnostics";

export async function instanceDoctorQuery(
  deps: { diagnostics: DiagnosticsPort },
): Promise<Result<unknown>> {
  try {
    return ok(await deps.diagnostics.instanceDoctor());
  } catch (error) {
    return err(error instanceof Error ? error.message : String(error));
  }
}
