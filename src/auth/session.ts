import { createHmac, timingSafeEqual } from "node:crypto";

const SESSION_VERSION = "v2";
const LEGACY_SESSION_VERSION = "v1";

export interface SessionPayload {
  userId: string;
  expiresAt: number;
  /** Unix ms when the cookie was issued; used to invalidate after password change. */
  issuedAt: number;
}

export function createSessionToken(payload: SessionPayload, secret: string): string {
  const issuedAt = payload.issuedAt;
  const data = `${SESSION_VERSION}.${payload.userId}.${payload.expiresAt}.${issuedAt}`;
  const signature = createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${signature}`;
}

export function verifySessionToken(token: string, secret: string): SessionPayload | null {
  const parts = token.split(".");
  if (parts.length === 4 && parts[0] === LEGACY_SESSION_VERSION) {
    return verifyLegacyV1(parts, secret);
  }
  if (parts.length !== 5) {
    return null;
  }

  const version = parts[0];
  const userId = parts[1];
  const expiresAtRaw = parts[2];
  const issuedAtRaw = parts[3];
  const signature = parts[4];
  if (
    version !== SESSION_VERSION ||
    userId === undefined ||
    expiresAtRaw === undefined ||
    issuedAtRaw === undefined ||
    signature === undefined
  ) {
    return null;
  }

  const expiresAt = Number(expiresAtRaw);
  const issuedAt = Number(issuedAtRaw);
  if (!Number.isFinite(expiresAt) || !Number.isFinite(issuedAt)) {
    return null;
  }

  const data = `${version}.${userId}.${expiresAtRaw}.${issuedAtRaw}`;
  if (!signaturesMatch(signature, data, secret)) {
    return null;
  }

  if (Date.now() > expiresAt) {
    return null;
  }

  return { userId, expiresAt, issuedAt };
}

function verifyLegacyV1(parts: string[], secret: string): SessionPayload | null {
  const version = parts[0];
  const userId = parts[1];
  const expiresAtRaw = parts[2];
  const signature = parts[3];
  if (version !== LEGACY_SESSION_VERSION || userId === undefined || expiresAtRaw === undefined || signature === undefined) {
    return null;
  }

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt)) {
    return null;
  }

  const data = `${version}.${userId}.${expiresAtRaw}`;
  if (!signaturesMatch(signature, data, secret)) {
    return null;
  }

  if (Date.now() > expiresAt) {
    return null;
  }

  // Approximate issued time for v1 cookies so password_updated_at checks still apply.
  const issuedAt = expiresAt - 7 * 24 * 60 * 60 * 1000;
  return { userId, expiresAt, issuedAt };
}

function signaturesMatch(signature: string, data: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(data).digest("base64url");
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
