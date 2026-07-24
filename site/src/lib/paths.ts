/** Site base from Astro config (may or may not include a trailing slash). */
const BASE = import.meta.env.BASE_URL;
const BASE_ROOT = BASE === "/" ? "/" : BASE.replace(/\/$/, "");

/** Build an in-site href that respects `base` (e.g. `/gojo` on GitHub Pages). */
export function href(path = "/"): string {
  if (!path || path === "/") {
    return BASE_ROOT;
  }
  if (path.startsWith("#")) {
    return `${BASE_ROOT === "/" ? "" : BASE_ROOT}/${path}`;
  }
  const clean = path.replace(/^\//, "");
  if (BASE_ROOT === "/") {
    return `/${clean}`;
  }
  return `${BASE_ROOT}/${clean}`;
}

/** Strip `base` from a pathname for active-nav comparisons. */
export function stripBase(pathname: string): string {
  if (BASE_ROOT !== "/" && (pathname === BASE_ROOT || pathname.startsWith(`${BASE_ROOT}/`))) {
    const rest = pathname.slice(BASE_ROOT.length);
    return rest === "" ? "/" : rest;
  }
  return pathname || "/";
}
