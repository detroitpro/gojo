const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const GRACEFUL_KILL_MS = 5_000;

export interface SpawnOptions {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
  maxOutputBytes?: number;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

export interface SpawnResult {
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  canceled: boolean;
  durationMs: number;
}

function killProcessGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // Process may already be gone.
    }
  }
}

async function readLimitedStream(
  stream: ReadableStream<Uint8Array> | null | undefined,
  maxBytes: number,
  onChunk?: (chunk: string) => void,
): Promise<string> {
  if (!stream) {
    return '';
  }

  const decoder = new TextDecoder();
  let captured = '';
  let byteCount = 0;
  const reader = stream.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      if (byteCount >= maxBytes) {
        continue;
      }

      const text = decoder.decode(value, { stream: true });
      const remaining = maxBytes - byteCount;
      const slice =
        Buffer.byteLength(text, 'utf8') <= remaining
          ? text
          : truncateUtf8(text, remaining);

      if (slice.length > 0) {
        captured += slice;
        byteCount += Buffer.byteLength(slice, 'utf8');
        onChunk?.(slice);
      }
    }

    const tail = decoder.decode();
    if (tail.length > 0 && byteCount < maxBytes) {
      const remaining = maxBytes - byteCount;
      const slice =
        Buffer.byteLength(tail, 'utf8') <= remaining
          ? tail
          : truncateUtf8(tail, remaining);
      if (slice.length > 0) {
        captured += slice;
        onChunk?.(slice);
      }
    }
  } finally {
    reader.releaseLock();
  }

  return captured;
}

function truncateUtf8(text: string, maxBytes: number): string {
  if (maxBytes <= 0) {
    return '';
  }

  let end = text.length;
  while (end > 0 && Buffer.byteLength(text.slice(0, end), 'utf8') > maxBytes) {
    end -= 1;
  }

  return text.slice(0, end);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function terminateProcess(
  proc: Bun.Subprocess<'ignore', 'pipe', 'pipe'>,
  reason: 'timeout' | 'cancel',
): Promise<{ timedOut: boolean; canceled: boolean }> {
  killProcessGroup(proc.pid, 'SIGTERM');
  await Promise.race([proc.exited, sleep(GRACEFUL_KILL_MS)]);

  if (proc.exitCode === null) {
    killProcessGroup(proc.pid, 'SIGKILL');
    await proc.exited;
  }

  return {
    timedOut: reason === 'timeout',
    canceled: reason === 'cancel',
  };
}

/** Run a subprocess with output capture, timeout, cancellation, and process-group cleanup. */
export async function runProcess(opts: SpawnOptions): Promise<SpawnResult> {
  const startedAt = Date.now();
  const maxOutputBytes = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  const env: Record<string, string | undefined> = {
    ...process.env,
    ...(opts.env ?? {}),
  };

  const proc = Bun.spawn([opts.command, ...opts.args], {
    cwd: opts.cwd,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
    detached: true,
  });

  let timedOut = false;
  let canceled = false;
  let abortReason: 'timeout' | 'cancel' | null = null;

  const timeoutId =
    opts.timeoutMs !== undefined
      ? setTimeout(() => {
          abortReason = 'timeout';
        }, opts.timeoutMs)
      : undefined;

  const onExternalAbort = (): void => {
    abortReason = 'cancel';
  };

  opts.signal?.addEventListener('abort', onExternalAbort, { once: true });

  const stdoutPromise = readLimitedStream(
    proc.stdout,
    maxOutputBytes,
    opts.onStdout,
  );
  const stderrPromise = readLimitedStream(
    proc.stderr,
    maxOutputBytes,
    opts.onStderr,
  );

  const exitPromise = proc.exited;

  while (true) {
    if (abortReason !== null) {
      const termination = await terminateProcess(proc, abortReason);
      timedOut = termination.timedOut;
      canceled = termination.canceled;
      break;
    }

    const raced = await Promise.race([
      exitPromise.then((code) => ({ kind: 'exit' as const, code })),
      sleep(50).then(() => ({ kind: 'pending' as const })),
    ]);

    if (raced.kind === 'exit') {
      break;
    }
  }

  if (timeoutId !== undefined) {
    clearTimeout(timeoutId);
  }
  opts.signal?.removeEventListener('abort', onExternalAbort);

  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);

  let exitCode = proc.exitCode;
  if (exitCode === null) {
    exitCode = await exitPromise;
  }

  return {
    exitCode,
    signal: proc.signalCode,
    stdout,
    stderr,
    timedOut,
    canceled,
    durationMs: Date.now() - startedAt,
  };
}
