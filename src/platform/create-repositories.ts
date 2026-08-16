/** Composition root for SQLite repository bag (transitional). */
import type { Database } from "@/infrastructure/persistence/db";
import type { Repositories } from "@/infrastructure/persistence/repositories";
import { createSecretRepository } from "@/contexts/access/contract";
import { createCatalogRepositories } from "@/contexts/catalog/contract";
import { createRunIntegrationRepository } from "@/contexts/delivery/contract";
import { createRunRepositories } from "@/contexts/execution/contract";
import { createAuditRepository } from "@/contexts/operations/contract";

export type { Repositories } from "@/infrastructure/persistence/repositories";

/** @removal(when: AppContext holds typed per-context ports): dissolve createRepositories bag — S1 */
export function createRepositories(db: Database): Repositories {
  return {
    ...createCatalogRepositories(db),
    ...createRunRepositories(db),
    audit: createAuditRepository(db),
    secrets: createSecretRepository(db),
    runIntegrations: createRunIntegrationRepository(db),
  };
}
