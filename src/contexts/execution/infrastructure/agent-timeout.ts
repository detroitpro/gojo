import { parseTimeout } from '@/platform/duration';
import type { Agent, Profile } from '@/infrastructure/persistence/types';

/** Fallback when a profile omits `timeout` (30 minutes). */
export const DEFAULT_AGENT_TIMEOUT_MS = 30 * 60 * 1000;

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore
  }
  return {};
}

/**
 * Resolve adapter wall-clock timeout from the agent's profile `configJson`.
 * Missing timeout → default. Malformed timeout throws (surfaces at sync via
 * Zod; runtime throw is a last-resort guard).
 */
export function resolveAgentTimeoutMs(
  agent: Pick<Agent, 'profileId'>,
  profiles: { findById(id: string): Profile | null | undefined },
): number {
  if (!agent.profileId) {
    return DEFAULT_AGENT_TIMEOUT_MS;
  }
  const profile = profiles.findById(agent.profileId);
  if (!profile) {
    return DEFAULT_AGENT_TIMEOUT_MS;
  }
  const config = parseJsonObject(profile.configJson);
  const timeout = config['timeout'];
  if (typeof timeout !== 'string' || timeout.trim().length === 0) {
    return DEFAULT_AGENT_TIMEOUT_MS;
  }
  return parseTimeout(timeout);
}
