export {
  firstCommandToken,
  instanceDoctor,
  primaryValidationTool,
  projectDoctor,
  resolveTool,
  validationToolsForTasks,
} from "./doctor";
export type {
  DoctorToolCheck,
  InstanceDoctorResult,
  ProjectBaseCheckout,
  ProjectDoctorResult,
  ProjectValidationToolCheck,
} from "./doctor";
export {
  inspectRunningBinary,
  isDeletedExeLink,
} from "./binary-stale";
export type { RunningBinaryStatus } from "./binary-stale";
