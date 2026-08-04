import type { AppContext } from "@/platform/app-context";
import type { ApiErrorCode } from "@shared/api";
import { failure, readJsonBody, success, type AuthContext } from "@/transports/http/http";

import { isUseCaseFailure } from "./errors";
import { matchHttpRoute, type UseCaseRegistry } from "./registry";
import { createAppRuntime } from "./runtime";

/**
 * Try to dispatch a request to a registered use case.
 * Returns null when no route matches (caller falls through to legacy if-chain).
 *
 * Path params extracted from the route template take precedence over query-string
 * entries with the same key so URL-embedded identifiers can never be overridden.
 * The request's attached auth (populated by the router shell) is forwarded on the
 * `AppRuntime` so use cases can read the authenticated actor.
 */
export async function tryDispatchRegisteredRoute(
  registry: UseCaseRegistry,
  ctx: AppContext,
  request: Request,
  method: string,
  pathname: string,
): Promise<Response | null> {
  const match = matchHttpRoute(registry, method, pathname);
  if (!match) {
    return null;
  }
  const { useCase, params } = match;

  let bodyInput: Record<string, unknown> = {};
  if (method === "GET" || method === "DELETE") {
    const url = new URL(request.url);
    for (const [key, value] of url.searchParams.entries()) {
      bodyInput[key] = value;
    }
  } else {
    const parsed = await readJsonBody<unknown>(request);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      bodyInput = { ...(parsed as Record<string, unknown>) };
    }
  }

  const rawInput: Record<string, unknown> = { ...bodyInput, ...params };

  const auth = (request as Request & { auth?: AuthContext }).auth ?? null;
  const runtime = createAppRuntime(ctx, { auth });
  const result = await registry.execute(useCase.name, rawInput, runtime);
  if (!result.ok) {
    if (isUseCaseFailure(result.error)) {
      return failure(
        result.error.code as ApiErrorCode,
        result.error.message,
        result.error.status ?? (useCase.kind === "query" ? 500 : 400),
      );
    }
    const status = useCase.kind === "query" ? 500 : 400;
    const code = useCase.kind === "query" ? "internal_error" : "validation_error";
    return failure(code, String(result.error), status);
  }

  return success(result.value, useCase.http?.successStatus ?? 200);
}
