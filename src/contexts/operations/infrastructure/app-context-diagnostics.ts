import type { AppContext } from "@/platform/app-context";
import { instanceDoctor } from "@/contexts/operations/infrastructure/diagnostics/doctor";

import type { DiagnosticsPort } from "../ports/diagnostics";

export class AppContextDiagnostics implements DiagnosticsPort {
  constructor(private readonly ctx: AppContext) {}

  async instanceDoctor(): Promise<unknown> {
    return instanceDoctor(this.ctx);
  }
}
