/** Atlaskit AppProvider color modes (preference, including auto). */
export type ColorModePreference = "light" | "dark" | "auto";

export const COLOR_MODE_STORAGE_KEY = "gojo.colorMode";

export function isColorModePreference(value: string | null | undefined): value is ColorModePreference {
  return value === "light" || value === "dark" || value === "auto";
}

/** Default `light` so existing operators are not surprised by OS dark. */
export function readStoredColorMode(): ColorModePreference {
  try {
    const raw = localStorage.getItem(COLOR_MODE_STORAGE_KEY);
    if (isColorModePreference(raw)) return raw;
  } catch {
    /* private mode / blocked storage */
  }
  return "light";
}

export function writeStoredColorMode(mode: ColorModePreference): void {
  try {
    localStorage.setItem(COLOR_MODE_STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
}

/**
 * Fire when Atlaskit updates `data-color-mode` or OS preference changes under `auto`,
 * so canvas charts that bake CSS vars into uPlot can rebuild.
 */
export function subscribeColorMode(onChange: () => void): () => void {
  const el = document.documentElement;
  const mo = new MutationObserver(() => onChange());
  mo.observe(el, { attributes: true, attributeFilter: ["data-color-mode", "data-theme"] });

  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  const onMql = () => {
    if (el.getAttribute("data-color-mode") === "auto") onChange();
  };
  mql.addEventListener("change", onMql);

  return () => {
    mo.disconnect();
    mql.removeEventListener("change", onMql);
  };
}
