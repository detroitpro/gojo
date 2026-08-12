import { create } from "zustand";

import { createRefreshRegistry } from "@/platform/create-refresh-store";

export const useExecutionStore = create(() => {
  const { slice } = createRefreshRegistry();
  return { ...slice };
});
