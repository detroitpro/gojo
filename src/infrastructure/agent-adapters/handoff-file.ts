import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { HANDOFF_RELATIVE_PATH } from '@shared/workspace-files';

export function readHandoffIfPresent(workspacePath: string): unknown | undefined {
  const handoffPath = join(workspacePath, HANDOFF_RELATIVE_PATH);
  try {
    const raw = readFileSync(handoffPath, 'utf8');
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}
