import type { AgentAdapter } from '@/agents/adapter/types';
import { claudeAgentAdapter } from '@/agents/claude/adapter';
import { cursorAgentAdapter } from '@/agents/cursor/adapter';
import { shellAgentAdapter } from '@/agents/shell/adapter';

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
