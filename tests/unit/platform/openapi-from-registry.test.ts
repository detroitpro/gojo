import { describe, expect, test } from "bun:test";

import { getUseCaseRegistry, openApiPathsFromRegistry, resetUseCaseRegistryForTests } from "@/platform";

describe("platform/openapi-from-registry", () => {
  test("emits operationIds for registered scheduling routes", () => {
    resetUseCaseRegistryForTests();
    const paths = openApiPathsFromRegistry(getUseCaseRegistry());
    expect(paths["/api/v1/instance/scheduling"]?.["get"]).toMatchObject({
      operationId: "scheduling.policy.get",
    });
    expect(paths["/api/v1/instance/scheduling"]?.["patch"]).toMatchObject({
      operationId: "scheduling.policy.set",
    });
  });
});
