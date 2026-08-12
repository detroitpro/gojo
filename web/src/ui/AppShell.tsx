import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { LogOut, ShieldCheck } from "lucide-react";

import { logout } from "@/contexts/access/contract";
import { ColorModeMenu } from "@/ui/ColorModeMenu";
import { LiveStoreBridge } from "@/platform/LiveStoreBridge";
import { usePlatformEvents } from "@/platform/usePlatformEvents";
import { UiIcon } from "@/ui/UiIcon";

const STORAGE_KEY = "gojo.sidebar.collapsed";

const nav: Array<{
  to: string;
  label: string;
  name: string;
  icon?: string;
  lucideIcon?: typeof ShieldCheck;
}> = [
  {
    to: "/projects",
    label: "Projects",
    name: "projects",
    icon: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z",
  },
  {
    to: "/agents",
    label: "Agents",
    name: "agents",
    icon: "M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2m-6 9l2 2 4-4",
  },
  {
    to: "/runs",
    label: "Runs",
    name: "runs",
    icon: "M13 10V3L4 14h7v7l9-11h-7z",
  },
  {
    to: "/integrations",
    label: "Integrations",
    name: "integrations",
    icon: "M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5",
  },
  {
    to: "/approvals",
    label: "Approvals",
    name: "approvals",
    lucideIcon: ShieldCheck,
  },
  {
    to: "/impact",
    label: "Impact",
    name: "impact",
    icon: "M9 19v-6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2zm0 0V9a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v10m-6 0a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2m0 0V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2z",
  },
  {
    to: "/queue",
    label: "Queue",
    name: "queue",
    icon: "M4 6h16M4 12h10M4 18h14",
  },
  {
    to: "/schedules",
    label: "Schedules",
    name: "schedules",
    icon: "M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0z",
  },
  {
    to: "/adapters",
    label: "Adapters",
    name: "adapters",
    icon: "M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2z",
  },
  {
    to: "/settings",
    label: "Settings",
    name: "settings",
    icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
  },
];

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(STORAGE_KEY) === "1");
  const [mobileOpen, setMobileOpen] = useState(false);
  const { status: eventStatus, reconnect } = usePlatformEvents({
    topics: [],
    onEvent: () => {},
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const eventStatusLabel = useMemo(() => {
    if (eventStatus === "connected") return "Live";
    if (eventStatus === "degraded") return "Reconnecting";
    if (eventStatus === "connecting") return "Connecting";
    return "Offline";
  }, [eventStatus]);

  const activeName = useMemo(() => {
    const path = location.pathname;
    if (path.startsWith("/runs")) return "runs";
    if (path.startsWith("/agents")) return "agents";
    if (path === "/") return "dashboard";
    const hit = nav.find((n) => path === n.to || path.startsWith(`${n.to}/`));
    return hit?.name ?? "";
  }, [location.pathname]);

  const onLogout = useCallback(async () => {
    await logout();
    void navigate("/login");
  }, [navigate]);

  const shellClass = [
    "shell",
    collapsed ? "sidebar-collapsed" : "",
    mobileOpen ? "mobile-nav-open" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={shellClass}>
      <header className="topbar">
        <button
          className="icon-btn hamburger"
          type="button"
          aria-label="Open navigation"
          onClick={() => setMobileOpen(true)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              d="M4 7h16M4 12h16M4 17h16"
            />
          </svg>
        </button>
        <Link to="/" className="brand brand-mobile" title="Dashboard">
          gojo
        </Link>
        <button
          className="live-status live-status-mobile"
          type="button"
          title={`Updates: ${eventStatusLabel}`}
          onClick={() => reconnect()}
        >
          <span className={`live-dot live-dot-${eventStatus}`} />
          <span>{eventStatusLabel}</span>
        </button>
      </header>

      {mobileOpen ? (
        <div
          className="sidebar-backdrop"
          aria-hidden="true"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      <aside className="sidebar" aria-label={collapsed ? "Collapsed navigation" : "Navigation"}>
        <div className="sidebar-top">
          <Link to="/" className="brand-mark" title="Dashboard">
            <span className="brand-word">gojo</span>
            <span className="brand-tag">ops console</span>
          </Link>
          <button
            className="icon-btn collapse-btn"
            type="button"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand" : "Collapse"}
            onClick={() => setCollapsed((c) => !c)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                d={collapsed ? "M9 6l6 6-6 6" : "M15 6l-6 6 6 6"}
              />
            </svg>
          </button>
          <button
            className="icon-btn close-mobile"
            type="button"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                d="M6 6l12 12M18 6L6 18"
              />
            </svg>
          </button>
        </div>

        <nav className="sidebar-nav">
          {nav.map((item) => (
            <NavLink
              key={item.name}
              to={item.to}
              className={() => `nav-link${activeName === item.name ? " active" : ""}`}
              title={item.label}
            >
              {item.lucideIcon ? (
                <UiIcon icon={item.lucideIcon} className="nav-icon" size={20} />
              ) : (
                <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d={item.icon}
                  />
                </svg>
              )}
              <span className="nav-label">{item.label}</span>
            </NavLink>
          ))}

          <div className="sidebar-tools" role="group" aria-label="Account">
            <ColorModeMenu />
            <button
              type="button"
              className="nav-link"
              title="Sign out"
              onClick={() => void onLogout()}
            >
              <LogOut className="nav-icon" size={18} aria-hidden="true" />
              <span className="nav-label">Sign out</span>
            </button>
            <button
              className="nav-link live-status-nav"
              type="button"
              title={`Updates: ${eventStatusLabel}`}
              onClick={() => reconnect()}
            >
              <span className="nav-icon live-status-icon" aria-hidden="true">
                <span className={`live-dot live-dot-${eventStatus}`} />
              </span>
              <span className="nav-label live-label">{eventStatusLabel}</span>
            </button>
          </div>
        </nav>
      </aside>

      <main className="main">
        <LiveStoreBridge />
        <Outlet />
      </main>
    </div>
  );
}
