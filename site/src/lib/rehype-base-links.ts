type HastNode = {
  type?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

/** Prefix root-absolute links with Astro `base` so Markdown nav works on GitHub Pages. */
export function rehypeBaseLinks(base: string) {
  const prefix = base === "/" ? "" : base.replace(/\/$/, "");

  return () => (tree: HastNode) => {
    if (!prefix) return;

    const walk = (node: HastNode) => {
      if (node.type === "element" && node.tagName === "a") {
        const href = node.properties?.href;
        if (
          typeof href === "string" &&
          href.startsWith("/") &&
          !href.startsWith("//") &&
          href !== prefix &&
          !href.startsWith(`${prefix}/`)
        ) {
          node.properties = { ...node.properties, href: `${prefix}${href}` };
        }
      }
      for (const child of node.children ?? []) walk(child);
    };

    walk(tree);
  };
}
