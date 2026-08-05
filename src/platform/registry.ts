import type { z } from "zod";

import { err, type Result } from "@/kernel";

import type { UseCaseFailure } from "./errors";

/** Errors a use case handler may return. `string` for simple messages,
 *  `UseCaseFailure` for typed failures that map to HTTP status/code. */
export type UseCaseHandlerError = string | UseCaseFailure;

export type HttpBinding = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  /** Default 200; commands that create often use 201/202. */
  successStatus?: number;
  /** Read the request body as raw text (webhooks) instead of JSON. */
  rawBody?: boolean;
};

export type CliBinding = {
  group: string;
  command: string;
};

export type UseCaseKind = "command" | "query";

export type UseCaseDefinition<I = unknown, O = unknown, R = unknown> = {
  name: string;
  kind: UseCaseKind;
  /** Zod schema; output type may include Zod defaults (input ≠ output). */
  input: z.ZodTypeAny;
  output: z.ZodTypeAny;
  http?: HttpBinding;
  cli?: CliBinding;
  /**
   * Handle validated input. `runtime` is the composition bag from the transport
   * (scheduling module, repos, etc.). Typed loosely so contexts stay decoupled.
   */
  handle: (input: I, runtime: R) => Promise<Result<O, UseCaseHandlerError>>;
};

/** Constructor/register accept any concrete use-case definition. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RegistrableUseCase = UseCaseDefinition<any, any, any>;

export function defineQuery<I, O, R = unknown>(
  def: Omit<UseCaseDefinition<I, O, R>, "kind">,
): UseCaseDefinition<I, O, R> {
  return { ...def, kind: "query" };
}

export function defineCommand<I, O, R = unknown>(
  def: Omit<UseCaseDefinition<I, O, R>, "kind">,
): UseCaseDefinition<I, O, R> {
  return { ...def, kind: "command" };
}

/** Erased use-case handle for the registry map (input validated before call). */
export type AnyUseCase = {
  name: string;
  kind: UseCaseKind;
  input: z.ZodTypeAny;
  output: z.ZodTypeAny;
  http?: HttpBinding;
  cli?: CliBinding;
  handle: (
    input: unknown,
    runtime: unknown,
  ) => Promise<Result<unknown, UseCaseHandlerError>>;
};

function eraseUseCase(def: RegistrableUseCase): AnyUseCase {
  return {
    name: def.name,
    kind: def.kind,
    input: def.input,
    output: def.output,
    ...(def.http ? { http: def.http } : {}),
    ...(def.cli ? { cli: def.cli } : {}),
    handle: (input, runtime) => def.handle(input, runtime),
  };
}

export class UseCaseRegistry {
  private readonly byName = new Map<string, AnyUseCase>();

  constructor(initial: readonly RegistrableUseCase[] = []) {
    for (const useCase of initial) {
      this.register(useCase);
    }
  }

  register(useCase: RegistrableUseCase): void {
    if (this.byName.has(useCase.name)) {
      throw new Error(`Use case already registered: ${useCase.name}`);
    }
    this.byName.set(useCase.name, eraseUseCase(useCase));
  }

  get(name: string): AnyUseCase | undefined {
    return this.byName.get(name);
  }

  list(): AnyUseCase[] {
    return [...this.byName.values()];
  }

  findCli(group: string, command: string): AnyUseCase | null {
    for (const useCase of this.byName.values()) {
      if (useCase.cli?.group === group && useCase.cli.command === command) {
        return useCase;
      }
    }
    return null;
  }

  async execute(
    name: string,
    rawInput: unknown,
    runtime: unknown,
  ): Promise<Result<unknown, UseCaseHandlerError>> {
    const useCase = this.byName.get(name);
    if (!useCase) {
      return err(`unknown use case: ${name}`);
    }
    const parsed = useCase.input.safeParse(rawInput);
    if (!parsed.success) {
      return err(parsed.error.message);
    }
    return useCase.handle(parsed.data, runtime);
  }
}

export function createUseCaseRegistry(
  initial: readonly RegistrableUseCase[] = [],
): UseCaseRegistry {
  return new UseCaseRegistry(initial);
}

/**
 * Compile a route template such as `/api/v1/agents/{id}/enable` to a matcher that
 * returns the extracted params map (or null when the pathname does not match).
 * Path templates are exact-segment matches; `{name}` binds a single segment.
 */
function compileRouteMatcher(
  template: string,
): (pathname: string) => Record<string, string> | null {
  const templateSegments = template.split("/");
  const paramNames: (string | null)[] = templateSegments.map((segment) => {
    const match = /^\{([^{}/]+)\}$/.exec(segment);
    return match ? match[1]! : null;
  });
  return (pathname) => {
    const segments = pathname.split("/");
    if (segments.length !== templateSegments.length) {
      return null;
    }
    const params: Record<string, string> = {};
    for (let i = 0; i < segments.length; i += 1) {
      const templateSegment = templateSegments[i]!;
      const paramName = paramNames[i];
      const segment = segments[i]!;
      if (paramName != null) {
        if (segment.length === 0) {
          return null;
        }
        try {
          params[paramName] = decodeURIComponent(segment);
        } catch {
          return null;
        }
        continue;
      }
      if (templateSegment !== segment) {
        return null;
      }
    }
    return params;
  };
}

/** Result of matching an HTTP request against the registry. */
export type HttpRouteMatch = {
  useCase: AnyUseCase;
  params: Record<string, string>;
};

export function matchHttpRoute(
  registry: UseCaseRegistry,
  method: string,
  pathname: string,
): HttpRouteMatch | null {
  const upper = method.toUpperCase();
  for (const useCase of registry.list()) {
    if (!useCase.http || useCase.http.method !== upper) {
      continue;
    }
    if (!useCase.http.path.includes("{")) {
      if (useCase.http.path === pathname) {
        return { useCase, params: {} };
      }
      continue;
    }
    const matcher = compileRouteMatcher(useCase.http.path);
    const params = matcher(pathname);
    if (params) {
      return { useCase, params };
    }
  }
  return null;
}
