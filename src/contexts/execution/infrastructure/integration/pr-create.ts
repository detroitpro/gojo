/** CLI used by pull-request integration to open a PR. */
export type PrTool = 'gh' | 'tea';

export interface PrCreateInvocationInput {
  tool: PrTool;
  head: string;
  base: string;
  title: string;
  body: string;
  /** Tea / Forgejo login name (`tea pulls create --login`). */
  login?: string;
  /** Git remote used to discover the Forgejo host (`tea pulls create --remote`). */
  remote?: string;
}

export interface PrCreateInvocation {
  command: string;
  args: string[];
}

/** Coerce manifest/runtime values; unknown values fall back to `gh`. */
export function normalizePrTool(value: unknown): PrTool {
  return value === 'tea' ? 'tea' : 'gh';
}

/** Build argv for `gh pr create` or `tea pulls create`. */
export function buildPrCreateInvocation(input: PrCreateInvocationInput): PrCreateInvocation {
  if (input.tool === 'tea') {
    const args = [
      'pulls',
      'create',
      '--head',
      input.head,
      '--base',
      input.base,
      '--title',
      input.title,
      '--description',
      input.body,
    ];
    if (input.login?.trim()) {
      args.push('--login', input.login.trim());
    }
    if (input.remote?.trim()) {
      args.push('--remote', input.remote.trim());
    }
    return { command: 'tea', args };
  }

  return {
    command: 'gh',
    args: [
      'pr',
      'create',
      '--head',
      input.head,
      '--base',
      input.base,
      '--title',
      input.title,
      '--body',
      input.body,
    ],
  };
}

/** First http(s) URL in CLI stdout/stderr, if any. */
export function extractPrUrl(output: string): string | null {
  const match = output.match(/https?:\/\/[^\s]+/i);
  if (!match?.[0]) {
    return null;
  }
  return match[0].replace(/[.,;:)]+$/, '');
}
