export {
  firstCommandToken,
  instanceDoctor,
  primaryValidationTool,
  projectDoctor,
  resolveTool,
  validationToolsForAgents,
} from "./doctor";
export type {
  DoctorToolCheck,
  InstanceDoctorResult,
  InstanceNetworkDoctor,
  ProjectBaseCheckout,
  ProjectDoctorResult,
  ProjectValidationToolCheck,
  ProjectWorkspaceFilesCheck,
} from "./doctor";
export {
  inspectRunningBinary,
  isDeletedExeLink,
} from "./binary-stale";
export type { RunningBinaryStatus } from "./binary-stale";
