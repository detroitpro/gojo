type HastNode = {
  type?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

/** Prefix root-absolute links/images with Astro `base` for GitHub Pages. */
export function rehypeBaseLinks(base: string) {
  const prefix = base === "/" ? "" : base.replace(/\/$/, "");

  const withBase = (value: string): string => {
    if (
      value.startsWith("/") &&
      !value.startsWith("//") &&
      value !== prefix &&
      !value.startsWith(`${prefix}/`)
    ) {
      return `${prefix}${value}`;
    }
    return value;
  };

  return () => (tree: HastNode) => {
    if (!prefix) return;

    const walk = (node: HastNode) => {
      if (node.type === "element" && node.tagName === "a") {
        const href = node.properties?.href;
        if (typeof href === "string") {
          node.properties = { ...node.properties, href: withBase(href) };
        }
      }
      if (node.type === "element" && node.tagName === "img") {
        const src = node.properties?.src;
        if (typeof src === "string") {
          node.properties = { ...node.properties, src: withBase(src) };
        }
      }
      for (const child of node.children ?? []) walk(child);
    };

    walk(tree);
  };
}
