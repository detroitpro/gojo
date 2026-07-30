import { describe, expect, test } from 'bun:test';

import { scopedTokenAllows } from '@/api/auth';
import type { AuthContext } from '@/api/http';

function auth(scopes: string[]): AuthContext {
  return {
    userId: 'user-1',
    username: 'agent',
    authMethod: 'token',
    tokenId: 'token-1',
    scopes,
  };
}

describe('scopedTokenAllows', () => {
  test('matches progress, run approval, and control approval scopes exactly', () => {
    expect(
      scopedTokenAllows(
        auth(['run:progress:run-1']),
        'POST',
        '/api/v1/runs/run-1/progress',
      ),
    ).toBe(true);
    expect(
      scopedTokenAllows(auth(['run:approve:run-1']), 'POST', '/api/v1/runs/run-1/approve'),
    ).toBe(true);
    expect(
      scopedTokenAllows(
        auth(['control:approve:approval-1']),
        'POST',
        '/api/v1/approvals/approval-1/approve',
      ),
    ).toBe(true);
  });

  test('denies the wrong resource, method, and action', () => {
    const approval = auth(['control:approve:approval-1']);
    expect(
      scopedTokenAllows(approval, 'POST', '/api/v1/approvals/approval-2/approve'),
    ).toBe(false);
    expect(
      scopedTokenAllows(approval, 'GET', '/api/v1/approvals/approval-1/approve'),
    ).toBe(false);
    expect(
      scopedTokenAllows(approval, 'POST', '/api/v1/approvals/approval-1/reject'),
    ).toBe(false);
  });

  test('keeps session and unscoped admin tokens unrestricted', () => {
    expect(
      scopedTokenAllows(
        { userId: 'user-1', username: 'admin', authMethod: 'session' },
        'DELETE',
        '/api/v1/projects/project-1',
      ),
    ).toBe(true);
    expect(
      scopedTokenAllows(auth([]), 'DELETE', '/api/v1/projects/project-1'),
    ).toBe(true);
  });
});
