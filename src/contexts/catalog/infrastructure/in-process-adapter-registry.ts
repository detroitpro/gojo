import type { AgentAdapter } from "@/infrastructure/agent-adapters/adapter/types";
import { listAdapters as inProcessListAdapters } from "@/infrastructure/agent-adapters";

import type { AdapterRegistryPort } from "../ports/adapter-registry";

export class InProcessAdapterRegistry implements AdapterRegistryPort {
  list(): AgentAdapter[] {
    return inProcessListAdapters();
  }

  find(name: string): AgentAdapter | undefined {
    return inProcessListAdapters().find((adapter) => adapter.name === name);
  }
}
