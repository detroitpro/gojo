import { describe, expect, test } from "bun:test";

import {
  isAgentRunToken,
  matchesTokenQuery,
  parseScopes,
  toApiTokenView,
} from "@/contexts/access/domain/tokens";

const record = (over: Partial<Parameters<typeof toApiTokenView>[0]>) => ({
  id: "tok_1",
  userId: "usr_1",
  tokenHash: "hash",
  name: "personal",
  scopesJson: '["read","write"]',
  createdAt: "2026-01-01T00:00:00.000Z",
  expiresAt: null,
  ...over,
});

describe("contexts/access/domain/tokens", () => {
  test("parseScopes returns [] for invalid JSON or non-arrays", () => {
    expect(parseScopes("not json")).toEqual([]);
    expect(parseScopes("{}")).toEqual([]);
    expect(parseScopes("null")).toEqual([]);
    expect(parseScopes('["a", 1, "b", true]')).toEqual(["a", "b"]);
    expect(parseScopes('["read","write"]')).toEqual(["read", "write"]);
  });

  test("toApiTokenView projects public token fields with parsed scopes", () => {
    const view = toApiTokenView(
      record({ scopesJson: '["scheduling:read"]', expiresAt: "2027-01-01T00:00:00.000Z" }),
    );
    expect(view).toEqual({
      id: "tok_1",
      name: "personal",
      scopes: ["scheduling:read"],
      createdAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2027-01-01T00:00:00.000Z",
    });
  });

  test("isAgentRunToken flags per-run agent tokens by naming convention", () => {
    expect(isAgentRunToken({ name: "agent-run-abc" })).toBe(true);
    expect(isAgentRunToken({ name: "personal" })).toBe(false);
    expect(isAgentRunToken({ name: "AGENT-RUN-abc" })).toBe(false);
  });

  test("matchesTokenQuery is case-insensitive over name and id", () => {
    const view = toApiTokenView(record({ id: "tok_ABC", name: "Personal Token" }));
    expect(matchesTokenQuery(view, "")).toBe(true);
    expect(matchesTokenQuery(view, "personal")).toBe(true);
    expect(matchesTokenQuery(view, "ABC")).toBe(true);
    expect(matchesTokenQuery(view, "missing")).toBe(false);
  });
});
