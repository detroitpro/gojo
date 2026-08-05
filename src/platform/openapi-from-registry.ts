import type { UseCaseRegistry } from "./registry";

type OpenApiPathItem = Record<string, unknown>;

/**
 * Build OpenAPI `paths` entries from registered HTTP bindings.
 * Merges onto a hand-written base document until every route is registered.
 */
export function openApiPathsFromRegistry(
  registry: UseCaseRegistry,
): Record<string, OpenApiPathItem> {
  const paths: Record<string, OpenApiPathItem> = {};

  for (const useCase of registry.list()) {
    if (!useCase.http) continue;
    const { method, path, successStatus } = useCase.http;
    const item = paths[path] ?? {};
    const op: Record<string, unknown> = {
      operationId: useCase.name,
      summary: useCase.name,
      tags: [useCase.name.split(".")[0] ?? "api"],
      responses: {
        [String(successStatus ?? 200)]: {
          description: "Success",
          content: {
            "application/json": {
              schema: { type: "object" },
            },
          },
        },
      },
    };
    if (useCase.kind === "command" && method !== "GET") {
      op["requestBody"] = useCase.http?.rawBody
        ? {
            required: true,
            content: {
              "text/plain": { schema: { type: "string" } },
            },
          }
        : {
            required: true,
            content: {
              "application/json": {
                schema: { type: "object" },
              },
            },
          };
    }
    item[method.toLowerCase()] = op;
    paths[path] = item;
  }

  return paths;
}

export function mergeOpenApiPaths(
  base: Record<string, unknown>,
  fromRegistry: Record<string, OpenApiPathItem>,
): Record<string, unknown> {
  const merged = { ...base };
  for (const [path, item] of Object.entries(fromRegistry)) {
    const existing = (merged[path] as OpenApiPathItem | undefined) ?? {};
    merged[path] = { ...existing, ...item };
  }
  return merged;
}
