import { ref, type Ref } from "vue";

/**
 * Full-page loading only for the first successful paint (or after reset).
 * Live refreshes / polling must patch in place — never tear down the tree.
 */
export function useSoftLoading(initialLoading = true): {
  loading: Ref<boolean>;
  begin: () => boolean;
  end: (wasInitial: boolean) => void;
  /** Call when the viewed entity id changes so the next load can show a skeleton. */
  reset: () => void;
} {
  const loading = ref(initialLoading);
  let painted = false;

  return {
    loading,
    begin() {
      const wasInitial = !painted;
      if (wasInitial) loading.value = true;
      return wasInitial;
    },
    end(wasInitial: boolean) {
      if (wasInitial) loading.value = false;
      painted = true;
    },
    reset() {
      painted = false;
      loading.value = true;
    },
  };
}
