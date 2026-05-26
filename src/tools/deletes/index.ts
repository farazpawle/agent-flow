/**
 * Barrel exports for Phase 1 Group 6 destructive tools.
 */

export {
  projectDeleteSchema,
  taskDeleteSchema,
  withDeriveOp,
  type ProjectDeleteInput,
  type TaskDeleteInput,
} from "./schemas.js";

export { projectDelete } from "./projectDelete.js";
export { taskDelete } from "./taskDelete.js";
