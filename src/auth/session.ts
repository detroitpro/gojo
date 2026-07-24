import { createHmac, timingSafeEqual } from "node:crypto";

const SESSION_VERSION = "v1";

export interface SessionPayload {
  userId: string;
  expiresAt: number;
}

export function createSessionToken(payload: SessionPayload, secret: string): string {
  const data = `${SESSION_VERSION}.${payload.userId}.${payload.expiresAt}`;
  const signature = createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${signature}`;
}

export function verifySessionToken(token: string, secret: string): SessionPayload | null {
  const parts = token.split(".");
  if (parts.length !== 4) {
    return null;
  }

  const version = parts[0];
  const userId = parts[1];
  const expiresAtRaw = parts[2];
  const signature = parts[3];
  if (version !== SESSION_VERSION || userId === undefined || expiresAtRaw === undefined || signature === undefined) {
    return null;
  }

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt)) {
    return null;
  }

  const data = `${version}.${userId}.${expiresAtRaw}`;
  const expected = createHmac("sha256", secret).update(data).digest("base64url");
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return null;
  }

  if (Date.now() > expiresAt) {
    return null;
  }

  return { userId, expiresAt };
}
