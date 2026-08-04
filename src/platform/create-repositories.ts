/** Composition root for SQLite repository bag (transitional). */
import type { Database } from "@/infrastructure/persistence/db";
import type { Repositories } from "@/infrastructure/persistence/repositories";
import { createCatalogRepositories } from "@/contexts/catalog/infrastructure/catalog-repositories";
import { createRunRepositories } from "@/contexts/execution/infrastructure/run-repositories";
import { createRunIntegrationRepository } from "@/contexts/delivery/infrastructure/integration-repositories";
import { createSecretRepository } from "@/contexts/access/infrastructure/secret-repositories";
import { createAuditRepository } from "@/contexts/operations/infrastructure/audit-repositories";

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
