/** How a run was requested. Shared by scheduling priority and storage records. */
export type RunTrigger = "schedule" | "manual" | "api" | "web" | "heal" | "work";
