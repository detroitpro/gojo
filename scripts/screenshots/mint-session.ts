/**
 * Mint a gojo_session cookie for the live instance DB (read-only secret).
 *
 * Usage:
 *   bun run scripts/screenshots/mint-session.ts
 *   GOJO_USER=admin bun run scripts/screenshots/mint-session.ts
 */
import { resolvePaths } from "../../src/config/paths";
import { UserService } from "../../src/auth/users";
import { SecretStore } from "../../src/secrets/store";
import { Database } from "../../src/storage/index";

const SESSION_SECRET_NAME = "__gojo_session_secret__";

export function mintSessionToken(home?: string): string {
  const paths = resolvePaths(home);
  const db = Database.open(paths.db);
  try {
    const users = new UserService(db);
    const secrets = new SecretStore(db, paths);
    const username = process.env["GOJO_USER"];
    const user =
      username !== undefined && username.length > 0
        ? users.findByUsername(username)
        : users.findFirstAdmin();
    if (!user) {
      throw new Error(
        username
          ? `No user named "${username}" in ${paths.db}`
          : `No admin user in ${paths.db}`,
      );
    }
    const secret = secrets.get(SESSION_SECRET_NAME);
    if (!secret) {
      throw new Error(
        `No session secret in ${paths.db} — start the gojo daemon once so auth is initialized`,
      );
    }
    return users.createSessionToken(user.id, secret);
  } finally {
    db.close();
  }
}

if (import.meta.main) {
  process.stdout.write(`${mintSessionToken()}\n`);
}
