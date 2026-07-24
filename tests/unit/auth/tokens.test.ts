import { describe, expect, test } from "bun:test";

import { createApiToken, hashToken, isValidTokenFormat, verifyToken } from "@/auth/tokens";

describe("auth/tokens", () => {
  test("createApiToken returns token and hash", () => {
    const { token, hash } = createApiToken();
    expect(isValidTokenFormat(token)).toBe(true);
    expect(hash).toBe(hashToken(token));
  });

  test("verifyToken accepts matching token", () => {
    const { token, hash } = createApiToken();
    expect(verifyToken(token, hash)).toBe(true);
  });

  test("verifyToken rejects invalid format and hash", () => {
    const { hash } = createApiToken();
    expect(verifyToken("bad-token", hash)).toBe(false);
    expect(verifyToken("gojo_notbase64", hash)).toBe(false);
  });
});
