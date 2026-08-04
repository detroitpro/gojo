import { defineStore } from "pinia";

export const useNotificationsStore = defineStore("notifications", () => {
  const refreshers = new Set<() => void | Promise<void>>();

  function bindRefresh(fn: () => void | Promise<void>) {
    refreshers.add(fn);
  }

  function unbindRefresh(fn: () => void | Promise<void>) {
    refreshers.delete(fn);
  }

  async function invalidate(_topics?: readonly string[]) {
    await Promise.all([...refreshers].map((fn) => Promise.resolve(fn())));
  }

  return { bindRefresh, unbindRefresh, invalidate };
});
