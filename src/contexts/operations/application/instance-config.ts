import {
  domainEvent,
  err,
  ok,
  type Clock,
  type Result,
  type UnitOfWork,
} from "@/kernel";

import type {
  InstanceConfigStore,
  InstancePatch,
  InstanceView,
} from "../ports/instance-config-store";

export type InstanceConfigDeps = {
  store: InstanceConfigStore;
  clock: Clock;
  uow: UnitOfWork;
};

export async function getInstanceQuery(
  deps: { store: InstanceConfigStore },
): Promise<Result<InstanceView & { restartRequired: boolean }>> {
  return ok({ ...deps.store.view(), restartRequired: false });
}

export async function updateInstanceCommand(
  deps: InstanceConfigDeps,
  input: InstancePatch,
): Promise<Result<InstanceView & { restartRequired: boolean }>> {
  const keys: (keyof InstancePatch)[] = [
    "telemetryEnabled",
    "bindHost",
    "bindPort",
    "publicBaseUrl",
    "trustedProxies",
    "allowedOrigins",
    "ipAllowlist",
    "cookieSecure",
  ];
  if (!keys.some((key) => input[key] !== undefined)) {
    return err(
      "At least one of telemetryEnabled, bindHost, bindPort, publicBaseUrl, trustedProxies, allowedOrigins, ipAllowlist, cookieSecure is required",
    );
  }

  try {
    const { view, restartRequired } = deps.store.applyPatch(input);
    deps.uow.addEvent(
      domainEvent(
        {
          type: "instance.updated",
          entityKind: "instance",
          entityId: "instance",
          topics: ["dashboard"],
          data: {
            telemetryEnabled: view.telemetryEnabled,
            restartRequired,
            bindHost: view.bindHost,
          },
        },
        deps.clock.nowIso(),
      ),
    );
    return ok({ ...view, restartRequired });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err(message);
  }
}

export async function pauseInstanceCommand(
  deps: InstanceConfigDeps,
): Promise<Result<{ paused: boolean }>> {
  deps.store.pause();
  deps.uow.addEvent(
    domainEvent(
      {
        type: "instance.paused",
        entityKind: "instance",
        entityId: "instance",
        topics: ["dashboard", "overview", "queue"],
        data: { paused: true },
      },
      deps.clock.nowIso(),
    ),
  );
  return ok({ paused: true });
}

export async function resumeInstanceCommand(
  deps: InstanceConfigDeps,
): Promise<Result<{ paused: boolean }>> {
  deps.store.resume();
  deps.uow.addEvent(
    domainEvent(
      {
        type: "instance.resumed",
        entityKind: "instance",
        entityId: "instance",
        topics: ["dashboard", "overview", "queue"],
        data: { paused: false },
      },
      deps.clock.nowIso(),
    ),
  );
  return ok({ paused: false });
}
