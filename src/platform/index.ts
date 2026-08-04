export {
  createUseCaseRegistry,
  defineCommand,
  defineQuery,
  matchHttpRoute,
  UseCaseRegistry,
  type AnyUseCase,
  type CliBinding,
  type HttpBinding,
  type RegistrableUseCase,
  type UseCaseDefinition,
  type UseCaseHandlerError,
  type UseCaseKind,
} from "./registry";
export { createAppRuntime, type AppRuntime } from "./runtime";
export { getUseCaseRegistry, resetUseCaseRegistryForTests } from "./register";
export { composeModules, type ComposedModules } from "./composition";
export { tryDispatchRegisteredRoute } from "./http-dispatch";
export { tryDispatchCliUseCase } from "./cli-dispatch";
export {
  mergeOpenApiPaths,
  openApiPathsFromRegistry,
} from "./openapi-from-registry";
export {
  failureMessage,
  isUseCaseFailure,
  useCaseFailure,
  type UseCaseFailure,
} from "./errors";
