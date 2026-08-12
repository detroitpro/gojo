import { useEffect, useState } from "react";

import {
  platformEventHub,
  type PlatformEventConnectionStatus,
  type PlatformEventHub,
} from "@/infrastructure/platform-events";
import type { PlatformChangeEvent, PlatformEventTopic } from "@gojo/contracts/types";

export interface UsePlatformEventsOptions {
  topics: readonly PlatformEventTopic[];
  projectId?: string;
  onEvent: (event: PlatformChangeEvent) => void;
  hub?: PlatformEventHub;
}

export function usePlatformEvents(options: UsePlatformEventsOptions) {
  const hub = options.hub ?? platformEventHub;
  const [status, setStatus] = useState<PlatformEventConnectionStatus>(hub.status);

  useEffect(() => {
    const unsubscribeStatus = hub.subscribeStatus(setStatus);
    const unsubscribe = hub.subscribe(options.topics, options.onEvent, options.projectId);
    return () => {
      unsubscribe();
      unsubscribeStatus();
    };
  }, [hub, options.topics, options.projectId, options.onEvent]);

  return {
    status,
    reconnect: () => hub.reconnect(),
  };
}
