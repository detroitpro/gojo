import { describe, expect, test } from 'bun:test';

import {
  buildForgejoAutoMergeRequest,
  enableForgejoAutoMerge,
  extractPrNumberFromUrl,
  resolveForgejoToken,
} from '@/integration/forgejo-auto-merge';

describe('integration/forgejo-auto-merge', () => {
  test('extractPrNumberFromUrl parses /pulls/N', () => {
    expect(
      extractPrNumberFromUrl('http://192.168.5.251:3001/detroitpro/rhystic-gaming/pulls/54'),
    ).toBe(54);
    expect(extractPrNumberFromUrl('https://example.com/org/repo/pulls/7/files')).toBe(7);
    expect(extractPrNumberFromUrl('local://pr/gojo/branch')).toBeNull();
    expect(extractPrNumberFromUrl('https://github.com/org/repo/pull/12')).toBeNull();
  });

  test('buildForgejoAutoMergeRequest builds merge_when_checks_succeed payload', () => {
    expect(
      buildForgejoAutoMergeRequest({
        apiUrl: 'http://192.168.5.251:3001/',
        repo: 'detroitpro/rhystic-gaming',
        prNumber: 54,
        mergeStyle: 'squash',
        token: 'secret-token',
      }),
    ).toEqual({
      url: 'http://192.168.5.251:3001/api/v1/repos/detroitpro/rhystic-gaming/pulls/54/merge',
      headers: {
        Authorization: 'token secret-token',
        'Content-Type': 'application/json',
      },
      body: {
        Do: 'squash',
        merge_when_checks_succeed: true,
        delete_branch_after_merge: true,
      },
    });
  });

  test('resolveForgejoToken prefers GOJO_FORGEJO_TOKEN then FORGEJO_TOKEN', () => {
    expect(
      resolveForgejoToken({
        GOJO_FORGEJO_TOKEN: 'gojo-tok',
        FORGEJO_TOKEN: 'forge-tok',
      }),
    ).toBe('gojo-tok');
    expect(resolveForgejoToken({ FORGEJO_TOKEN: 'forge-tok' })).toBe('forge-tok');
    expect(resolveForgejoToken({})).toBeNull();
    expect(resolveForgejoToken({ FORGEJO_TOKEN: '  ' })).toBeNull();
  });

  test('enableForgejoAutoMerge posts merge_when_checks_succeed and reports HTTP errors', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init: init ?? {} });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;

    const err = await enableForgejoAutoMerge({
      prUrl: 'http://192.168.5.251:3001/detroitpro/rhystic-gaming/pulls/54',
      apiUrl: 'http://192.168.5.251:3001',
      repo: 'detroitpro/rhystic-gaming',
      token: 'tok',
      fetchImpl,
    });
    expect(err).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain('/pulls/54/merge');
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
      Do: 'squash',
      merge_when_checks_succeed: true,
    });

    const failFetch = (async () =>
      new Response(JSON.stringify({ message: 'not allowed' }), {
        status: 403,
      })) as unknown as typeof fetch;
    const fail = await enableForgejoAutoMerge({
      prUrl: 'http://192.168.5.251:3001/detroitpro/rhystic-gaming/pulls/54',
      apiUrl: 'http://192.168.5.251:3001',
      repo: 'detroitpro/rhystic-gaming',
      token: 'tok',
      fetchImpl: failFetch,
    });
    expect(fail).toContain('HTTP 403');
    expect(fail).toContain('not allowed');

    const missingToken = await enableForgejoAutoMerge({
      prUrl: 'http://192.168.5.251:3001/detroitpro/rhystic-gaming/pulls/54',
      apiUrl: 'http://192.168.5.251:3001',
      repo: 'detroitpro/rhystic-gaming',
      token: null,
      fetchImpl,
    });
    expect(missingToken).toContain('FORGEJO_TOKEN');
  });
});
