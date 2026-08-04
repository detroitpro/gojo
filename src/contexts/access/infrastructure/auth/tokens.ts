import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_PREFIX = "gojo_";
const TOKEN_BYTES = 32;

export function createApiToken(): { token: string; hash: string } {
  const raw = randomBytes(TOKEN_BYTES);
  const token = `${TOKEN_PREFIX}${raw.toString("base64url")}`;
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isValidTokenFormat(token: string): boolean {
  return token.startsWith(TOKEN_PREFIX) && token.length > TOKEN_PREFIX.length;
}

export function verifyToken(token: string, hash: string): boolean {
  if (!isValidTokenFormat(token)) {
    return false;
  }

  const computed = hashToken(token);
  const left = Buffer.from(computed, "hex");
  const right = Buffer.from(hash, "hex");
  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}
