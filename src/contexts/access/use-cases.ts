import { z } from "zod";

import { defineCommand, defineQuery } from "@/platform/registry";
import type { AppRuntime } from "@/platform/runtime";
import { useCaseFailure } from "@/platform/errors";
import { parsePageParams, parseSortParams } from "@shared/pagination";

/** Sort keys accepted by `GET /api/v1/auth/tokens`. */
const TOKEN_SORT_ALLOWED = ["name", "createdAt", "expiresAt"] as const;

/** Queries with no meaningful input — ignore query/body shape. */
const EmptyInput = z.any().transform(() => ({}) as Record<string, never>);

const AuthTokenListInputSchema = z
  .object({
    limit: z.union([z.string(), z.number()]).optional().nullable(),
    offset: z.union([z.string(), z.number()]).optional().nullable(),
    sort: z.string().optional().nullable(),
    order: z.string().optional().nullable(),
    q: z.string().optional().nullable(),
    includeAgent: z.union([z.string(), z.boolean()]).optional().nullable(),
  })
  .passthrough()
  .transform((raw) => ({
    page: parsePageParams({
      limit: raw.limit != null ? String(raw.limit) : null,
      offset: raw.offset != null ? String(raw.offset) : null,
    }),
    sort: parseSortParams(
      { sort: raw.sort ?? null, order: raw.order ?? null },
      {
        allowed: TOKEN_SORT_ALLOWED,
        defaultSort: "createdAt",
        defaultOrder: "desc",
      },
    ),
    q: (raw.q ?? "").trim().toLowerCase(),
    includeAgent: raw.includeAgent === "1" || raw.includeAgent === true,
  }));

const CreateApiTokenInputSchema = z
  .object({
    name: z.string().min(1, "name is required"),
    scopes: z.array(z.string()).optional(),
    expiresAt: z.string().nullable().optional(),
  })
  .passthrough();

const RevokeApiTokenInputSchema = z
  .object({
    id: z.string().min(1, "id is required"),
  })
  .passthrough();

const unauthorized = () =>
  useCaseFailure("unauthorized", "Authentication required", 401);

export const GetMe = defineQuery<Record<string, never>, unknown, AppRuntime>({
  name: "access.me.get",
  input: EmptyInput,
  output: z.any(),
  http: { method: "GET", path: "/api/v1/auth/me" },
  async handle(_input, runtime) {
    if (!runtime.auth) return unauthorized();
    return runtime.access.getMe(runtime.auth.userId);
  },
});

export const ListApiTokens = defineQuery<
  z.infer<typeof AuthTokenListInputSchema>,
  unknown,
  AppRuntime
>({
  name: "access.tokens.list",
  input: AuthTokenListInputSchema,
  output: z.any(),
  http: { method: "GET", path: "/api/v1/auth/tokens" },
  async handle(input, runtime) {
    if (!runtime.auth) return unauthorized();
    return runtime.access.listTokens({
      userId: runtime.auth.userId,
      page: input.page,
      sort: input.sort.sort as "name" | "createdAt" | "expiresAt",
      order: input.sort.order,
      q: input.q,
      includeAgent: input.includeAgent,
    });
  },
});

export const CreateApiToken = defineCommand<
  z.infer<typeof CreateApiTokenInputSchema>,
  unknown,
  AppRuntime
>({
  name: "access.tokens.create",
  input: CreateApiTokenInputSchema,
  output: z.any(),
  http: { method: "POST", path: "/api/v1/auth/tokens", successStatus: 201 },
  async handle(input, runtime) {
    if (!runtime.auth) return unauthorized();
    return runtime.access.createToken({
      userId: runtime.auth.userId,
      name: input.name,
      ...(input.scopes ? { scopes: input.scopes } : {}),
      ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
    });
  },
});

export const RevokeApiToken = defineCommand<
  z.infer<typeof RevokeApiTokenInputSchema>,
  unknown,
  AppRuntime
>({
  name: "access.tokens.revoke",
  input: RevokeApiTokenInputSchema,
  output: z.any(),
  http: { method: "DELETE", path: "/api/v1/auth/tokens/{id}" },
  async handle(input, runtime) {
    if (!runtime.auth) return unauthorized();
    return runtime.access.revokeToken({
      userId: runtime.auth.userId,
      tokenId: input.id,
    });
  },
});

export const accessUseCases = [
  GetMe,
  ListApiTokens,
  CreateApiToken,
  RevokeApiToken,
] as const;
