import { existsSync, readlinkSync, statSync } from 'node:fs';
import { platform } from 'node:os';

export interface RunningBinaryStatus {
  /** True when the process is likely running a replaced/outdated binary. */
  stale: boolean;
  /** Human-readable reason when stale. */
  detail: string | null;
  exePath: string | null;
}

/** Linux `/proc/<pid>/exe` readlink ends with this when the file was replaced. */
export function isDeletedExeLink(link: string): boolean {
  return link.endsWith(' (deleted)');
}

/**
 * Detect a gojo daemon that was not restarted after `make install` /
 * `install:cli` replaced the on-disk binary (Linux deleted-inode case).
 */
export function inspectRunningBinary(
  pid: number = process.pid,
  execPath: string = process.execPath,
): RunningBinaryStatus {
  if (platform() === 'linux') {
    const procExe = `/proc/${pid}/exe`;
    try {
      const link = readlinkSync(procExe);
      if (isDeletedExeLink(link)) {
        return {
          stale: true,
          detail:
            'Running binary inode was replaced on disk (exe shows deleted). Restart gojo after install: systemctl --user restart gojo (or make service-restart).',
          exePath: link,
        };
      }
      return { stale: false, detail: null, exePath: link };
    } catch {
      // Fall through to mtime heuristics.
    }
  }

  // Best-effort: if argv0 path exists and is newer than the running image's
  // mtime... not reliable across platforms. Only flag when execPath is missing.
  if (!existsSync(execPath)) {
    return {
      stale: true,
      detail:
        'process.execPath is missing on disk — restart the gojo service after install.',
      exePath: execPath,
    };
  }

  try {
    statSync(execPath);
  } catch {
    return {
      stale: true,
      detail: 'Could not stat process.execPath — restart gojo after install.',
      exePath: execPath,
    };
  }

  return { stale: false, detail: null, exePath: execPath };
}
