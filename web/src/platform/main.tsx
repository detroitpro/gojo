import { forwardRef, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link } from "react-router-dom";
import AppProvider, { type RouterLinkComponentProps } from "@atlaskit/app-provider";
import { setBooleanFeatureFlagResolver } from "@atlaskit/platform-feature-flags";
import { StrictMode } from "react";
import "@atlaskit/css-reset";

import { App } from "./App";
import { readStoredColorMode } from "./color-mode";
import "@/ui/styles.css";

/**
 * Atlaskit components call FeatureGates for internal experiments (e.g.
 * platform_dst_scrollbar_harmonisation). Outside Atlassian we have no Statsig
 * client — default boolean flags to false so unknown gates never throw.
 *
 * Opt in to the Popup trigger-ref fix: without it, @atlaskit/popup only attaches
 * the Popper reference while open, so menus first paint at (0,0) under React 18.
 * @see @atlaskit/popup use-get-memoized-merged-trigger-ref.js
 */
const ATLASKIT_ENABLED_FLAGS = new Set(["platform-design-system-popup-ref"]);
setBooleanFeatureFlagResolver((flag) => ATLASKIT_ENABLED_FLAGS.has(flag));

const initialColorMode = readStoredColorMode();

const RouterLink = forwardRef<HTMLAnchorElement, RouterLinkComponentProps>(
  function RouterLink({ href, children, ...rest }, ref) {
    if (typeof href === "string") {
      const { to: _ignored, ...linkRest } = rest as ComponentProps<typeof Link> & {
        to?: string;
      };
      return (
        <Link ref={ref} to={href} {...linkRest}>
          {children}
        </Link>
      );
    }
    return (
      <a ref={ref} href="#" {...rest}>
        {children}
      </a>
    );
  },
);

const container = document.getElementById("app");
if (!container) {
  throw new Error("Missing #app root");
}

createRoot(container).render(
  <StrictMode>
    <AppProvider defaultColorMode={initialColorMode} routerLinkComponent={RouterLink}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AppProvider>
  </StrictMode>,
);
