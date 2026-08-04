import { UserService } from "@/contexts/access/infrastructure/auth/users";
import type { Database } from "@/infrastructure/persistence";

import type { UserServicePort } from "../ports/user-service";

/** Constructs the access-context user service on top of the existing SQLite UserService. */
export function createSqliteUserService(db: Database): UserServicePort {
  return new UserService(db);
}
