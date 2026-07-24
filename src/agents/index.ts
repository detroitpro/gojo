export type {
  AgentAdapter,
  AgentExecuteContext,
  AgentExecuteResult,
} from './adapter/types';

export { claudeAgentAdapter, ClaudeAgentAdapter } from './claude/adapter';
export { cursorAgentAdapter, CursorAgentAdapter } from './cursor/adapter';
export {
  getAdapter,
  getRegisteredAdapterNames,
  listAdapters,
  registerAdapter,
} from './registry';
export { shellAgentAdapter, ShellAgentAdapter } from './shell/adapter';
