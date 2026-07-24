import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const HANDOFF_RELATIVE_PATH = '.gojo/handoff.json';

export function readHandoffIfPresent(workspacePath: string): unknown | undefined {
  const handoffPath = join(workspacePath, HANDOFF_RELATIVE_PATH);
  try {
    const raw = readFileSync(handoffPath, 'utf8');
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}
