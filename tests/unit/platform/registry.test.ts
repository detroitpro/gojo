import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { err, ok } from "@/kernel";
import {
  createUseCaseRegistry,
  defineCommand,
  defineQuery,
  matchHttpRoute,
} from "@/platform/registry";

describe("platform/registry", () => {
  const Echo = defineQuery<{ message: string }, { message: string }>({
    name: "demo.echo",
    input: z.object({ message: z.string() }),
    output: z.object({ message: z.string() }),
    http: { method: "GET", path: "/api/v1/demo/echo" },
    async handle(input) {
      return ok({ message: input.message });
    },
  });

  const SetThing = defineCommand<{ value: number }, { value: number }>({
    name: "demo.set",
    input: z.object({ value: z.number().int().positive() }),
    output: z.object({ value: z.number() }),
    http: { method: "PATCH", path: "/api/v1/demo/thing" },
    cli: { group: "demo", command: "set" },
    async handle(input) {
      if (input.value > 100) return err("too big");
      return ok({ value: input.value });
    },
  });

  test("registers use cases by name and rejects duplicates", () => {
    const registry = createUseCaseRegistry();
    registry.register(Echo);
    expect(() => registry.register(Echo)).toThrow(/already registered/);
    expect(registry.get("demo.echo")?.name).toBe("demo.echo");
    expect(registry.list().map((u) => u.name)).toEqual(["demo.echo"]);
  });

  test("matchHttpRoute finds exact routes", () => {
    const registry = createUseCaseRegistry([Echo, SetThing]);
    expect(matchHttpRoute(registry, "GET", "/api/v1/demo/echo")?.useCase.name).toBe(
      "demo.echo",
    );
    expect(matchHttpRoute(registry, "GET", "/api/v1/demo/echo")?.params).toEqual({});
    expect(matchHttpRoute(registry, "PATCH", "/api/v1/demo/thing")?.useCase.name).toBe(
      "demo.set",
    );
    expect(matchHttpRoute(registry, "GET", "/api/v1/demo/thing")).toBeNull();
  });

  test("matchHttpRoute extracts single path param", () => {
    const GetAgent = defineQuery<{ id: string }, { id: string }>({
      name: "catalog.agent.get",
      input: z.object({ id: z.string() }),
      output: z.object({ id: z.string() }),
      http: { method: "GET", path: "/api/v1/agents/{id}" },
      async handle(input) {
        return ok({ id: input.id });
      },
    });
    const registry = createUseCaseRegistry([GetAgent]);
    const match = matchHttpRoute(registry, "GET", "/api/v1/agents/abc123");
    expect(match?.useCase.name).toBe("catalog.agent.get");
    expect(match?.params).toEqual({ id: "abc123" });
    // Empty path segment cannot bind a param.
    expect(matchHttpRoute(registry, "GET", "/api/v1/agents/")).toBeNull();
    // Different segment count never matches.
    expect(matchHttpRoute(registry, "GET", "/api/v1/agents/abc/enable")).toBeNull();
  });

  test("matchHttpRoute extracts multiple path params and decodes URI segments", () => {
    const RefreshSource = defineCommand<
      { id: string; sourceId: string },
      { id: string; sourceId: string }
    >({
      name: "catalog.project.source.refresh",
      input: z.object({ id: z.string(), sourceId: z.string() }),
      output: z.object({ id: z.string(), sourceId: z.string() }),
      http: {
        method: "POST",
        path: "/api/v1/projects/{id}/sources/{sourceId}/refresh",
      },
      async handle(input) {
        return ok(input);
      },
    });
    const registry = createUseCaseRegistry([RefreshSource]);
    const match = matchHttpRoute(
      registry,
      "POST",
      "/api/v1/projects/proj%20one/sources/src-42/refresh",
    );
    expect(match?.params).toEqual({ id: "proj one", sourceId: "src-42" });
  });

  test("matchHttpRoute prefers method match; other verbs on same template do not collide", () => {
    const GetProject = defineQuery<{ id: string }, { id: string }>({
      name: "catalog.project.get",
      input: z.object({ id: z.string() }),
      output: z.object({ id: z.string() }),
      http: { method: "GET", path: "/api/v1/projects/{id}" },
      async handle(input) {
        return ok({ id: input.id });
      },
    });
    const DeleteProject = defineCommand<{ id: string }, { removed: boolean }>({
      name: "catalog.project.delete",
      input: z.object({ id: z.string() }),
      output: z.object({ removed: z.boolean() }),
      http: { method: "DELETE", path: "/api/v1/projects/{id}" },
      async handle() {
        return ok({ removed: true });
      },
    });
    const registry = createUseCaseRegistry([GetProject, DeleteProject]);
    expect(
      matchHttpRoute(registry, "GET", "/api/v1/projects/p1")?.useCase.name,
    ).toBe("catalog.project.get");
    expect(
      matchHttpRoute(registry, "DELETE", "/api/v1/projects/p1")?.useCase.name,
    ).toBe("catalog.project.delete");
    expect(matchHttpRoute(registry, "PATCH", "/api/v1/projects/p1")).toBeNull();
  });

  test("execute validates input and maps Result", async () => {
    const registry = createUseCaseRegistry([SetThing]);
    const bad = await registry.execute("demo.set", { value: 0 }, {});
    expect(bad.ok).toBe(false);

    const good = await registry.execute("demo.set", { value: 3 }, {});
    expect(good).toEqual(ok({ value: 3 }));

    const logicErr = await registry.execute("demo.set", { value: 101 }, {});
    expect(logicErr).toEqual(err("too big"));
  });

  test("findCli resolves group/command", () => {
    const registry = createUseCaseRegistry([Echo, SetThing]);
    expect(registry.findCli("demo", "set")?.name).toBe("demo.set");
    expect(registry.findCli("demo", "echo")).toBeNull();
  });
});
