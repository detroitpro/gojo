/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "contracts-no-daemon",
      severity: "error",
      comment: "packages/contracts must not depend on daemon src/",
      from: { path: "^packages/contracts" },
      to: { path: "^src/" },
    },
    {
      name: "kernel-is-leaf",
      severity: "error",
      comment: "kernel must not import any other src/ layer",
      from: { path: "^src/kernel" },
      to: { path: "^src/(?!kernel)" },
    },
    {
      name: "kernel-no-transports",
      severity: "error",
      comment: "kernel must not import HTTP/CLI/WS transports",
      from: { path: "^src/kernel" },
      to: { path: "^src/transports/" },
    },
    {
      name: "infrastructure-is-leaf",
      severity: "error",
      comment: "infrastructure must not import contexts, platform, or transports",
      from: { path: "^src/infrastructure" },
      to: { path: "^src/(contexts|platform|transports)/" },
    },
    {
      name: "contexts-no-transports",
      severity: "error",
      comment: "bounded contexts must not import transports",
      from: { path: "^src/contexts" },
      to: { path: "^src/transports/" },
    },
    {
      name: "no-circular",
      severity: "warn",
      from: {},
      to: { circular: true },
    },
    {
      name: "contexts-domain-isolation",
      severity: "error",
      comment: "context domain layers may not import infrastructure, application, transports, or platform",
      from: { path: "^src/contexts/[^/]+/domain" },
      to: {
        path: "^src/(contexts/[^/]+/(infrastructure|application)|transports|platform|infrastructure)",
        pathNot: "^src/contexts/[^/]+/domain",
      },
    },
    {
      name: "contexts-app-no-infra",
      severity: "error",
      comment: "context application layers may not import their own infrastructure",
      from: { path: "^src/contexts/([^/]+)/application" },
      to: { path: "^src/contexts/$1/infrastructure" },
    },
    {
      name: "cross-context-via-contract",
      severity: "error",
      comment: "cross-context imports must go through contexts/*/contract",
      from: { path: "^src/contexts/([^/]+)/" },
      to: {
        path: "^src/contexts/(?!\\1)([^/]+)/(?!contract(?:\\.ts$|/))",
      },
    },
    {
      name: "web-kernel-is-leaf",
      severity: "error",
      comment: "web kernel must not import other web layers",
      from: { path: "^web/src/kernel" },
      to: { path: "^web/src/(?!kernel)" },
    },
    {
      name: "web-infrastructure-no-contexts",
      severity: "error",
      comment: "web infrastructure must not import contexts or platform",
      from: { path: "^web/src/infrastructure" },
      to: { path: "^web/src/(contexts|platform)/" },
    },
    {
      name: "web-cross-context-via-contract",
      severity: "error",
      comment: "web cross-context imports must go through contexts/*/contract",
      from: { path: "^web/src/contexts/([^/]+)/" },
      to: {
        path: "^web/src/contexts/(?!\\1)([^/]+)/(?!contract(?:\\.ts$|/))",
      },
    },
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
    },
    tsConfig: {
      fileName: "tsconfig.json",
    },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
  },
};
