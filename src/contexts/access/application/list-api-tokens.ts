import { ok, type Result } from "@/kernel";
import {
  compareSortValues,
  paginateArray,
  type PageParams,
} from "@shared/pagination";

import {
  isAgentRunToken,
  matchesTokenQuery,
  toApiTokenView,
  type ApiTokenView,
} from "../domain/tokens";
import type { UserServicePort } from "../ports/user-service";

export type ListApiTokensDeps = {
  users: UserServicePort;
};

export type ListApiTokensInput = {
  userId: string;
  page: PageParams;
  sort: "name" | "createdAt" | "expiresAt";
  order: "asc" | "desc";
  q: string;
  includeAgent: boolean;
};

export type ListApiTokensOutput = {
  tokens: ApiTokenView[];
  total: number;
  limit: number;
  offset: number;
};

export async function listApiTokensQuery(
  deps: ListApiTokensDeps,
  input: ListApiTokensInput,
): Promise<Result<ListApiTokensOutput>> {
  const all = deps.users
    .listApiTokens(input.userId)
    .filter((record) => input.includeAgent || !isAgentRunToken(record))
    .map(toApiTokenView);
  const filtered = all.filter((token) => matchesTokenQuery(token, input.q));
  const sorted = [...filtered].sort((a, b) => {
    const key = input.sort as keyof ApiTokenView;
    return compareSortValues(a[key], b[key], input.order);
  });
  const paged = paginateArray(sorted, input.page);
  return ok({
    tokens: paged.items,
    total: paged.total,
    limit: paged.limit,
    offset: paged.offset,
  });
}
