import { describe, expect, test } from 'bun:test';

import {
  buildPrCreateInvocation,
  extractPrUrl,
  normalizePrTool,
} from '@/integration/pr-create';

describe('integration/pr-create', () => {
  test('normalizePrTool defaults to gh', () => {
    expect(normalizePrTool(undefined)).toBe('gh');
    expect(normalizePrTool('gh')).toBe('gh');
    expect(normalizePrTool('tea')).toBe('tea');
    expect(normalizePrTool('other')).toBe('gh');
  });

  test('buildPrCreateInvocation for gh uses body flag', () => {
    expect(
      buildPrCreateInvocation({
        tool: 'gh',
        head: 'gojo/feature',
        base: 'main',
        title: 'Title',
        body: 'Body text',
      }),
    ).toEqual({
      command: 'gh',
      args: [
        'pr',
        'create',
        '--head',
        'gojo/feature',
        '--base',
        'main',
        '--title',
        'Title',
        '--body',
        'Body text',
      ],
    });
  });

  test('buildPrCreateInvocation for tea uses pulls create and description', () => {
    expect(
      buildPrCreateInvocation({
        tool: 'tea',
        head: 'gojo/feature',
        base: 'main',
        title: 'Title',
        body: 'Body text',
        login: 'home',
        remote: 'origin',
      }),
    ).toEqual({
      command: 'tea',
      args: [
        'pulls',
        'create',
        '--head',
        'gojo/feature',
        '--base',
        'main',
        '--title',
        'Title',
        '--description',
        'Body text',
        '--login',
        'home',
        '--remote',
        'origin',
      ],
    });
  });

  test('buildPrCreateInvocation for tea omits optional login/remote when unset', () => {
    expect(
      buildPrCreateInvocation({
        tool: 'tea',
        head: 'gojo/feature',
        base: 'main',
        title: 'Title',
        body: 'Body',
      }),
    ).toEqual({
      command: 'tea',
      args: [
        'pulls',
        'create',
        '--head',
        'gojo/feature',
        '--base',
        'main',
        '--title',
        'Title',
        '--description',
        'Body',
      ],
    });
  });

  test('extractPrUrl finds first http(s) URL', () => {
    expect(extractPrUrl('https://github.com/org/repo/pull/12\n')).toBe(
      'https://github.com/org/repo/pull/12',
    );
    expect(
      extractPrUrl('created\nVisit http://192.168.5.251:3001/detroitpro/rhystic-gaming/pulls/7\nok'),
    ).toBe('http://192.168.5.251:3001/detroitpro/rhystic-gaming/pulls/7');
    expect(extractPrUrl('no url here')).toBeNull();
  });
});
