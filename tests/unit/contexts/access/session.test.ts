import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";

import { createSessionToken, verifySessionToken } from "@/contexts/access/infrastructure/auth/session";

const SECRET = "test-session-secret";

describe("auth/session", () => {
  test("verifySessionToken accepts a valid v2 token", () => {
    const expiresAt = Date.now() + 60_000;
    const issuedAt = Date.now();
    const token = createSessionToken({ userId: "user-1", expiresAt, issuedAt }, SECRET);

    expect(verifySessionToken(token, SECRET)).toEqual({
      userId: "user-1",
      expiresAt,
      issuedAt,
    });
  });

  test("verifySessionToken accepts legacy v1 tokens with approximate issuedAt", () => {
    const expiresAt = Date.now() + 60_000;
    const data = `v1.user-1.${expiresAt}`;
    const signature = createHmac("sha256", SECRET).update(data).digest("base64url");
    const token = `${data}.${signature}`;

    const payload = verifySessionToken(token, SECRET);
    expect(payload?.userId).toBe("user-1");
    expect(payload?.expiresAt).toBe(expiresAt);
    expect(payload?.issuedAt).toBe(expiresAt - 7 * 24 * 60 * 60 * 1000);
  });

  test("verifySessionToken rejects tampered, malformed, and expired tokens", () => {
    const expiresAt = Date.now() + 60_000;
    const issuedAt = Date.now();
    const token = createSessionToken({ userId: "user-1", expiresAt, issuedAt }, SECRET);

    expect(verifySessionToken(`${token}x`, SECRET)).toBeNull();
    expect(verifySessionToken("v1.user.not-a-number.sig", SECRET)).toBeNull();
    expect(verifySessionToken(token, "wrong-secret")).toBeNull();

    const expired = createSessionToken(
      { userId: "user-1", expiresAt: Date.now() - 1, issuedAt },
      SECRET,
    );
    expect(verifySessionToken(expired, SECRET)).toBeNull();
  });

  test("verifySessionToken rejects malformed v2 and invalid legacy v1 tokens", () => {
    expect(verifySessionToken("v2.user.exp.sig", SECRET)).toBeNull();

    const expiresAtRaw = "not-a-number";
    const issuedAtRaw = String(Date.now());
    const data = `v2.user-1.${expiresAtRaw}.${issuedAtRaw}`;
    const signature = createHmac("sha256", SECRET).update(data).digest("base64url");
    expect(verifySessionToken(`${data}.${signature}`, SECRET)).toBeNull();

    const expiresAt = Date.now() + 60_000;
    expect(verifySessionToken(`v1.user-1.${expiresAt}.tampered-signature`, SECRET)).toBeNull();
  });
});
