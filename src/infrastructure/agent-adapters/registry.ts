import type { AgentAdapter } from '@/infrastructure/agent-adapters/adapter/types';
import { claudeAgentAdapter } from '@/infrastructure/agent-adapters/claude/adapter';
import { cursorAgentAdapter } from '@/infrastructure/agent-adapters/cursor/adapter';
import { shellAgentAdapter } from '@/infrastructure/agent-adapters/shell/adapter';

const adapters = new Map<string, AgentAdapter>([
  [shellAgentAdapter.name, shellAgentAdapter],
  [cursorAgentAdapter.name, cursorAgentAdapter],
  [claudeAgentAdapter.name, claudeAgentAdapter],
]);

export function registerAdapter(adapter: AgentAdapter): void {
  adapters.set(adapter.name, adapter);
}

export function getAdapter(name: string): AgentAdapter | undefined {
  return adapters.get(name);
}

export function listAdapters(): AgentAdapter[] {
  return [...adapters.values()];
}

export function getRegisteredAdapterNames(): string[] {
  return [...adapters.keys()].sort();
}
