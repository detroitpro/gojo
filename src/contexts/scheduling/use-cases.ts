import { z } from "zod";

import { SchedulingPolicySchema } from "@shared/scheduling";
import { defineCommand, defineQuery } from "@/platform/registry";
import type { AppRuntime } from "@/platform/runtime";

/** Queries with no meaningful input — ignore query/body shape. */
const EmptyInput = z.any().transform(() => ({} as Record<string, never>));

export const GetSchedulingPolicy = defineQuery<
  Record<string, never>,
  { policy: z.infer<typeof SchedulingPolicySchema> },
  AppRuntime
>({
  name: "scheduling.policy.get",
  input: EmptyInput,
  output: z.object({ policy: SchedulingPolicySchema }),
  http: { method: "GET", path: "/api/v1/instance/scheduling" },
  cli: { group: "instance", command: "scheduling-show" },
  async handle(_input, runtime) {
    return runtime.scheduling.getPolicy();
  },
});

export const SetSchedulingPolicy = defineCommand<
  z.infer<typeof SchedulingPolicySchema>,
  { policy: z.infer<typeof SchedulingPolicySchema> },
  AppRuntime
>({
  name: "scheduling.policy.set",
  input: SchedulingPolicySchema,
  output: z.object({ policy: SchedulingPolicySchema }),
  http: { method: "PATCH", path: "/api/v1/instance/scheduling" },
  cli: { group: "instance", command: "scheduling-set" },
  async handle(input, runtime) {
    const result = await runtime.scheduling.setPolicy(input);
    if (result.ok) {
      runtime.kickDispatcher();
      return { ok: true, value: { policy: result.value.policy } };
    }
    return result;
  },
});

export const schedulingUseCases = [GetSchedulingPolicy, SetSchedulingPolicy] as const;
