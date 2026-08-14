import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { UserService } from '@/contexts/access/infrastructure/auth/users';
import { Database } from '@/infrastructure/persistence';
import type { AppContext } from '@/platform/app-context';
import { isScopedAgentToken, resolveAuth, scopedTokenAllows } from '@/transports/http/auth';
import { SESSION_COOKIE, type AuthContext } from '@/transports/http/http';

const SESSION_SECRET = 'test-session-secret';

function withAuthContext(
  fn: (
    ctx: Pick<AppContext, 'db' | 'getSessionSecret'>,
    users: UserService,
  ) => void | Promise<void>,
) {
  const dir = mkdtempSync(join(tmpdir(), 'gojo-auth-resolve-'));
  const db = Database.open(join(dir, 'gojo.db'));
  db.migrate();
  const users = new UserService(db);
  const ctx = {
    db,
    getSessionSecret: () => SESSION_SECRET,
  } as Pick<AppContext, 'db' | 'getSessionSecret'>;

  return Promise.resolve(fn(ctx, users)).finally(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
}

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

  test('denies scopes that omit a resource id', () => {
    expect(
      scopedTokenAllows(auth(['run:progress']), 'POST', '/api/v1/runs/run-1/progress'),
    ).toBe(false);
    expect(
      scopedTokenAllows(auth(['unknown:action:run-1']), 'POST', '/api/v1/runs/run-1/progress'),
    ).toBe(false);
  });
});

describe('isScopedAgentToken', () => {
  test('is true only for non-empty bearer token scopes', () => {
    expect(
      isScopedAgentToken({
        userId: 'user-1',
        username: 'agent',
        authMethod: 'token',
        tokenId: 'token-1',
        scopes: ['run:progress:run-1'],
      }),
    ).toBe(true);
    expect(
      isScopedAgentToken({
        userId: 'user-1',
        username: 'agent',
        authMethod: 'token',
        tokenId: 'token-1',
        scopes: [],
      }),
    ).toBe(false);
    expect(
      isScopedAgentToken({ userId: 'user-1', username: 'admin', authMethod: 'session' }),
    ).toBe(false);
  });
});

describe('resolveAuth', () => {
  test('authenticates bearer API tokens with scopes', async () => {
    await withAuthContext(async (ctx, users) => {
      const admin = await users.createUser('admin', 'password-here', 'admin');
      const { token, record } = users.createApiTokenForUser(admin.id, 'agent-run', {
        scopes: ['run:progress:run-1'],
      });

      const request = new Request('http://localhost/api/v1/runs/run-1/progress', {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(resolveAuth(ctx as AppContext, request)).toEqual({
        userId: admin.id,
        username: 'admin',
        authMethod: 'token',
        tokenId: record.id,
        scopes: ['run:progress:run-1'],
      });
    });
  });

  test('authenticates session cookies', async () => {
    await withAuthContext(async (ctx, users) => {
      const admin = await users.createUser('admin', 'password-here', 'admin');
      const session = users.createSessionToken(admin.id, SESSION_SECRET);

      const request = new Request('http://localhost/api/v1/me', {
        headers: { Cookie: `${SESSION_COOKIE}=${encodeURIComponent(session)}` },
      });

      expect(resolveAuth(ctx as AppContext, request)).toEqual({
        userId: admin.id,
        username: 'admin',
        authMethod: 'session',
      });
    });
  });

  test('returns null for invalid bearer and session credentials', async () => {
    await withAuthContext(async (ctx, users) => {
      const admin = await users.createUser('admin', 'password-here', 'admin');
      const session = users.createSessionToken(admin.id, SESSION_SECRET);

      expect(
        resolveAuth(
          ctx as AppContext,
          new Request('http://localhost/api/v1/me', {
            headers: { Authorization: 'Bearer gojo_invalid' },
          }),
        ),
      ).toBeNull();
      expect(
        resolveAuth(
          ctx as AppContext,
          new Request('http://localhost/api/v1/me', {
            headers: { Cookie: `${SESSION_COOKIE}=${encodeURIComponent(`${session}x`)}` },
          }),
        ),
      ).toBeNull();
      expect(
        resolveAuth(
          ctx as AppContext,
          new Request('http://localhost/api/v1/me', {
            headers: {
              Authorization: 'Bearer gojo_invalid',
              Cookie: `${SESSION_COOKIE}=${encodeURIComponent(session)}`,
            },
          }),
        ),
      ).toEqual({
        userId: admin.id,
        username: 'admin',
        authMethod: 'session',
      });
    });
  });
});
