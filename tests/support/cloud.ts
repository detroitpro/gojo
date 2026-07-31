import { describe, test } from "bun:test";

/**
 * True on constrained cloud dev VMs (e.g. Cursor Cloud agents) where concurrent
 * git subprocess tests often exceed the default per-test timeout.
 *
 * CI still runs the full suite. Set GOJO_RUN_CLOUD_INCOMPATIBLE_TESTS=1 to
 * force them locally or in cloud.
 */
export function isCloudDevEnvironment(): boolean {
  if (process.env["GOJO_RUN_CLOUD_INCOMPATIBLE_TESTS"] === "1") {
    return false;
  }
  if (process.env["CI"] === "true" || process.env["CI"] === "1") {
    return false;
  }
  return (
    process.env["CURSOR_AGENT"] === "1" ||
    process.env["GOJO_CLOUD_DEV"] === "1"
  );
}

/** describe() that is skipped in cloud dev (see AGENTS.md). */
export const describeUnlessCloud: typeof describe = isCloudDevEnvironment()
  ? describe.skip
  : describe;

/** test() that is skipped in cloud dev. */
export const testUnlessCloud: typeof test = isCloudDevEnvironment()
  ? test.skip
  : test;
