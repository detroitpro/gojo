import {
  onScopeDispose,
  readonly,
  ref,
  toValue,
  watch,
  type MaybeRefOrGetter,
} from "vue";

import {
  platformEventHub,
  type PlatformEventConnectionStatus,
  type PlatformEventHub,
} from "@/infrastructure/platform-events";
import type { PlatformChangeEvent, PlatformEventTopic } from "@gojo/contracts/types";

export interface UsePlatformEventsOptions {
  topics: readonly PlatformEventTopic[];
  projectId?: MaybeRefOrGetter<string | undefined>;
  onEvent: (event: PlatformChangeEvent) => void;
  hub?: PlatformEventHub;
}

export function usePlatformEvents(options: UsePlatformEventsOptions) {
  const hub = options.hub ?? platformEventHub;
  const status = ref<PlatformEventConnectionStatus>(hub.status);
  const unsubscribeStatus = hub.subscribeStatus((value) => {
    status.value = value;
  });
  let unsubscribe = hub.subscribe(
    options.topics,
    options.onEvent,
    toValue(options.projectId),
  );
  const stopProjectWatch = watch(
    () => toValue(options.projectId),
    (projectId, previous) => {
      if (projectId === previous) return;
      unsubscribe();
      unsubscribe = hub.subscribe(options.topics, options.onEvent, projectId);
    },
  );

  onScopeDispose(() => {
    unsubscribe();
    stopProjectWatch();
    unsubscribeStatus();
  });

  return {
    status: readonly(status),
    reconnect: () => hub.reconnect(),
  };
}
