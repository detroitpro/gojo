import { describe, expect, test } from "bun:test";

import { createSessionToken, verifySessionToken } from "@/auth/session";

const SECRET = "test-session-secret";

describe("auth/session", () => {
  test("verifySessionToken accepts a valid token", () => {
    const expiresAt = Date.now() + 60_000;
    const token = createSessionToken({ userId: "user-1", expiresAt }, SECRET);

    expect(verifySessionToken(token, SECRET)).toEqual({ userId: "user-1", expiresAt });
  });

  test("verifySessionToken rejects tampered, malformed, and expired tokens", () => {
    const expiresAt = Date.now() + 60_000;
    const token = createSessionToken({ userId: "user-1", expiresAt }, SECRET);

    expect(verifySessionToken(`${token}x`, SECRET)).toBeNull();
    expect(verifySessionToken("v1.user.not-a-number.sig", SECRET)).toBeNull();
    expect(verifySessionToken(token, "wrong-secret")).toBeNull();

    const expired = createSessionToken({ userId: "user-1", expiresAt: Date.now() - 1 }, SECRET);
    expect(verifySessionToken(expired, SECRET)).toBeNull();
  });
});
