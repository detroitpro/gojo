import {
  onScopeDispose,
  readonly,
  ref,
  shallowRef,
  watch,
  type MaybeRefOrGetter,
  type ShallowRef,
} from "vue";

import type { PlatformEventTopic } from "../types";
import type { PlatformEventHub } from "../lib/platform-events";
import { usePlatformEvents } from "./usePlatformEvents";

export interface UseLiveRefreshOptions {
  topics: readonly PlatformEventTopic[];
  refresh: () => void | Promise<void>;
  projectId?: MaybeRefOrGetter<string | undefined>;
  coalesceMs?: number;
  fallbackMs?: number;
  immediate?: boolean;
  hub?: PlatformEventHub;
}

export function useLiveRefresh(options: UseLiveRefreshOptions) {
  const coalesceMs = options.coalesceMs ?? 100;
  const fallbackMs = options.fallbackMs ?? 30_000;
  let coalesceTimer: ReturnType<typeof setTimeout> | null = null;
  let fallbackTimer: ReturnType<typeof setInterval> | null = null;
  let inFlight: Promise<void> | null = null;
  let queued = false;

  const run = (): Promise<void> => {
    if (inFlight) {
      queued = true;
      return inFlight;
    }
    inFlight = Promise.resolve(options.refresh())
      .catch(() => {
        // Views and useLiveQuery own their visible error state.
      })
      .finally(() => {
        inFlight = null;
        if (queued) {
          queued = false;
          void run();
        }
      });
    return inFlight;
  };

  const schedule = () => {
    if (coalesceTimer) clearTimeout(coalesceTimer);
    coalesceTimer = setTimeout(() => {
      coalesceTimer = null;
      void run();
    }, coalesceMs);
  };

  const { status, reconnect } = usePlatformEvents({
    topics: options.topics,
    ...(options.projectId !== undefined ? { projectId: options.projectId } : {}),
    onEvent: schedule,
    ...(options.hub ? { hub: options.hub } : {}),
  });

  watch(status, (value, previous) => {
    if (value === "degraded" || (value === "connected" && previous === "degraded")) {
      void run();
    }
  });

  if (typeof window !== "undefined") {
    fallbackTimer = setInterval(() => {
      if (status.value !== "connected") void run();
    }, fallbackMs);
    window.addEventListener("focus", run);
    window.addEventListener("online", reconnect);
  }

  if (options.immediate !== false) void run();

  onScopeDispose(() => {
    if (coalesceTimer) clearTimeout(coalesceTimer);
    if (fallbackTimer) clearInterval(fallbackTimer);
    if (typeof window !== "undefined") {
      window.removeEventListener("focus", run);
      window.removeEventListener("online", reconnect);
    }
  });

  return { status, refresh: run };
}

export interface UseLiveQueryOptions<T> {
  topics: readonly PlatformEventTopic[];
  query: () => Promise<T>;
  initial?: T | null;
  projectId?: MaybeRefOrGetter<string | undefined>;
  coalesceMs?: number;
  fallbackMs?: number;
  immediate?: boolean;
  hub?: PlatformEventHub;
}

export function useLiveQuery<T>(options: UseLiveQueryOptions<T>) {
  const data = shallowRef<T | null>(options.initial ?? null) as ShallowRef<T | null>;
  const loading = ref(options.immediate !== false);
  const refreshing = ref(false);
  const error = ref<string | null>(null);
  const updatedAt = ref<string | null>(null);

  const load = async () => {
    if (data.value === null) loading.value = true;
    else refreshing.value = true;
    try {
      data.value = await options.query();
      error.value = null;
      updatedAt.value = new Date().toISOString();
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : String(caught);
      throw caught;
    } finally {
      loading.value = false;
      refreshing.value = false;
    }
  };

  const live = useLiveRefresh({
    topics: options.topics,
    refresh: load,
    ...(options.projectId !== undefined ? { projectId: options.projectId } : {}),
    ...(options.coalesceMs !== undefined ? { coalesceMs: options.coalesceMs } : {}),
    ...(options.fallbackMs !== undefined ? { fallbackMs: options.fallbackMs } : {}),
    ...(options.immediate !== undefined ? { immediate: options.immediate } : {}),
    ...(options.hub ? { hub: options.hub } : {}),
  });

  return {
    data,
    loading: readonly(loading),
    refreshing: readonly(refreshing),
    error: readonly(error),
    updatedAt: readonly(updatedAt),
    status: live.status,
    refresh: live.refresh,
  };
}
