import { describe, expect, test } from "bun:test";

import { hashPassword, verifyPassword } from "@/auth/password";

describe("auth/password", () => {
  test("hashPassword returns verifiable bcrypt hash", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash.startsWith("$2")).toBe(true);
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
    expect(await verifyPassword("wrong password", hash)).toBe(false);
  });
});
