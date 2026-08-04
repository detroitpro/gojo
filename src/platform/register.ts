import { accessUseCases } from "@/contexts/access/use-cases";
import { catalogUseCases } from "@/contexts/catalog/use-cases";
import { deliveryUseCases } from "@/contexts/delivery/use-cases";
import { executionUseCases } from "@/contexts/execution/use-cases";
import { notificationsUseCases } from "@/contexts/notifications/use-cases";
import { operationsUseCases } from "@/contexts/operations/use-cases";
import { schedulingUseCases } from "@/contexts/scheduling/use-cases";
import { workUseCases } from "@/contexts/work/use-cases";

import { createUseCaseRegistry, type UseCaseRegistry } from "./registry";

/** Singleton registry of all migrated use cases. Grows as contexts move onto it. */
let cached: UseCaseRegistry | null = null;

export function getUseCaseRegistry(): UseCaseRegistry {
  if (!cached) {
    cached = createUseCaseRegistry([
      ...schedulingUseCases,
      ...accessUseCases,
      ...catalogUseCases,
      ...deliveryUseCases,
      ...executionUseCases,
      ...notificationsUseCases,
      ...operationsUseCases,
      ...workUseCases,
    ]);
  }
  return cached;
}

/** Test helper — rebuild registry from scratch. */
export function resetUseCaseRegistryForTests(): void {
  cached = null;
}
