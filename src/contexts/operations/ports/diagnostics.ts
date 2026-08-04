/**
 * Diagnostic ports for the operations context. Wrapping `instanceDoctor`
 * keeps the doctor use case free of filesystem plumbing.
 */
export interface DiagnosticsPort {
  instanceDoctor(): Promise<unknown>;
}
