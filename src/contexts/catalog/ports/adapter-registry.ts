import type { AgentAdapter } from "@/infrastructure/agent-adapters/adapter/types";

/** Port over the in-process agent adapter registry. */
export interface AdapterRegistryPort {
  list(): AgentAdapter[];
  find(name: string): AgentAdapter | undefined;
}
